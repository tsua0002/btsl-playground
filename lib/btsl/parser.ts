// BTSL Parser - Phase 0 & 1 Implementation
import {
  BTSLDocument,
  BTSLParam,
  BTSLConst,
  BTSLSchema,
  BTSLInput,
  BTSLOutput,
  BTSLCalcAssignment,
  BTSLAssertion,
  BTSLScriptDef,
  BTSLScriptPath,
  BTSLError,
  BTSLWarning,
  ParseResult,
  ParamType,
} from './types';

// Tokenize the schema
function tokenizeLines(content: string): string[] {
  return content.split('\n');
}

// Check for mixed indentation
function checkIndentation(lines: string[]): BTSLError | null {
  let useTabs: boolean | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith(';') || line.trim().startsWith('#')) continue;
    
    const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
    if (leadingWhitespace.length === 0) continue;
    
    const hasTabs = leadingWhitespace.includes('\t');
    const hasSpaces = leadingWhitespace.includes(' ');
    
    if (hasTabs && hasSpaces) {
      return {
        code: 'BTSL_ERR_00',
        message: 'Mixed tabs and spaces in indentation',
        line: i + 1
      };
    }
    
    if (useTabs === null && leadingWhitespace.length > 0) {
      useTabs = hasTabs;
    } else if (useTabs !== null && leadingWhitespace.length > 0) {
      if (useTabs && hasSpaces) {
        return {
          code: 'BTSL_ERR_00',
          message: 'Inconsistent indentation style (expected tabs)',
          line: i + 1
        };
      }
      if (!useTabs && hasTabs) {
        return {
          code: 'BTSL_ERR_00',
          message: 'Inconsistent indentation style (expected spaces)',
          line: i + 1
        };
      }
    }
  }
  
  return null;
}

// Get indentation level (relative units for nesting comparisons).
// Spaces: each 2 columns ≈ one step so both 2-space and 4-space styles work (old code used /4 only, which broke 2-space files).
// Tabs: each tab counts as two steps so one tab ≈ one 4-space step in typical editor settings.
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  const whitespace = match[1];
  if (whitespace.includes('\t')) {
    return (whitespace.split('\t').length - 1) * 2;
  }
  if (whitespace.length === 0) return 0;
  return Math.ceil(whitespace.length / 2);
}

function parseWorkflowUtxoRef(raw: string): { workflow: BTSLInput['workflowRef']; internalUtxoParam: string } | null {
  // workflow outpoint syntax: SCHEMA_NAME:outputIndex.txid:vout
  // Example: VAULT_DEPOSIT:0.txid:0
  const m = raw.match(/^([A-Z][A-Za-z0-9_]*):(\d+)\.txid:(\d+)$/);
  if (!m) return null;
  const schemaName = m[1];
  const outputIndex = parseInt(m[2], 10);
  const vout = parseInt(m[3], 10);
  const internalUtxoParam = `WF_${schemaName}_${outputIndex}_${vout}`;
  return { workflow: { schemaName, outputIndex, vout }, internalUtxoParam };
}

// Parse VERSION header
function parseVersion(lines: string[]): { version: number; lineIndex: number } | BTSLError {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;
    
    const match = line.match(/^VERSION:\s*(\d+)/);
    if (match) {
      return { version: parseInt(match[1], 10), lineIndex: i };
    } else {
      return {
        code: 'BTSL_ERR_00',
        message: 'VERSION header must be the first non-comment, non-blank line',
        line: i + 1
      };
    }
  }
  
  return {
    code: 'BTSL_ERR_00',
    message: 'VERSION header not found',
    line: 1
  };
}

// Extract @PARAM declarations (Phase 0.2)
function extractParams(content: string): { params: BTSLParam[]; warnings: BTSLWarning[] } {
  const params: BTSLParam[] = [];
  const warnings: BTSLWarning[] = [];
  const lines = content.split('\n');
  
  let inParamsSection = false;
  let baseIndent = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    
    // Check for PARAMS: section
    if (trimmed === 'PARAMS:' || trimmed.startsWith('PARAMS:')) {
      inParamsSection = true;
      baseIndent = getIndentLevel(line);
      continue;
    }
    
    // Check if we're still in PARAMS section
    if (inParamsSection) {
      const currentIndent = getIndentLevel(line);
      if (currentIndent <= baseIndent && !trimmed.startsWith('@')) {
        inParamsSection = false;
        continue;
      }
      
      // Parse @PARAM declaration
      const paramMatch = trimmed.match(/^@([A-Z][A-Za-z0-9_]*)(?::([A-Z_]+))?/);
      if (paramMatch) {
        const name = paramMatch[1];
        const typeStr = paramMatch[2] as ParamType | undefined;
        
        let type: ParamType = 'UNTYPED';
        const normalizedType =
          typeStr && /^pubkey$/i.test(typeStr) ? 'PUBKEY' : typeStr;
        if (
          normalizedType &&
          ['UTXO', 'ADDRESS', 'FEERATE', 'HEX_DATA', 'SATOSHI', 'PUBKEY'].includes(normalizedType)
        ) {
          type = normalizedType as ParamType;
        } else if (typeStr) {
          type = 'UNTYPED';
          warnings.push({
            code: 'BTSL_WARN_03',
            message: `Unknown type "${typeStr}" for @${name}, treated as untyped`,
            line: i + 1
          });
        } else if (!typeStr) {
          warnings.push({
            code: 'BTSL_WARN_03',
            message: `@${name} is untyped, degraded to flexible mode`,
            line: i + 1
          });
        }
        
        // Check for duplicates
        if (!params.find(p => p.name === name)) {
          params.push({ name, type });
        }
      }
    }
  }
  
  return { params, warnings };
}

// Parse CONST section
function parseConsts(lines: string[], startIdx: number): { consts: BTSLConst[]; endIdx: number } {
  const consts: BTSLConst[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip CONST: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(\d+|"[^"]*"|0x[0-9a-fA-F]+)/);
    if (match) {
      const name = match[1];
      let value: number | string = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (!value.startsWith('0x')) {
        value = parseInt(value, 10);
      }
      consts.push({ name, value });
    }
    i++;
  }
  
  return { consts, endIdx: i };
}

// Parse SCRIPT_DEFS section
function parseScriptDefs(lines: string[], startIdx: number): { scriptDefs: BTSLScriptDef[]; endIdx: number } {
  const scriptDefs: BTSLScriptDef[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip SCRIPT_DEFS: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse script definition header: NAME TYPE:
    const defMatch = trimmed.match(/^([A-Z][A-Za-z0-9_]*)\s+(P2TR|P2WSH|P2SH):?$/);
    if (defMatch) {
      const scriptDef: BTSLScriptDef = {
        name: defMatch[1],
        type: defMatch[2] as 'P2TR' | 'P2WSH' | 'P2SH',
      };
      
      i++;
      const defBaseIndent = currentIndent;
      
      // Parse script body
      while (i < lines.length) {
        const bodyLine = lines[i];
        const bodyTrimmed = bodyLine.trim();
        
        if (bodyTrimmed === '' || bodyTrimmed.startsWith(';') || bodyTrimmed.startsWith('#')) {
          i++;
          continue;
        }
        
        const bodyIndent = getIndentLevel(bodyLine);
        if (bodyIndent <= defBaseIndent) break;
        
        // Parse internal_key
        if (bodyTrimmed.startsWith('internal_key:')) {
          scriptDef.internalKey = bodyTrimmed.replace('internal_key:', '').trim();
          i++;
          continue;
        }
        
        // Parse asm (inline or multiline)
        if (bodyTrimmed.startsWith('asm:')) {
          const asmInline = bodyTrimmed.replace('asm:', '').trim();
          if (asmInline) {
            scriptDef.asm = asmInline.split(/\s+/).filter(Boolean);
          } else {
            scriptDef.asm = [];
            i++;
            const asmBaseIndent = bodyIndent;
            while (i < lines.length) {
              const asmLine = lines[i];
              const asmTrimmed = asmLine.trim();
              if (asmTrimmed === '' || asmTrimmed.startsWith(';') || asmTrimmed.startsWith('#')) {
                i++;
                continue;
              }
              const asmIndent = getIndentLevel(asmLine);
              if (asmIndent <= asmBaseIndent) break;
              scriptDef.asm.push(...asmTrimmed.split(/\s+/).filter(Boolean));
              i++;
            }
            continue;
          }
          i++;
          continue;
        }
        
        // Parse paths
        if (bodyTrimmed === 'paths:') {
          scriptDef.paths = [];
          i++;
          const pathsBaseIndent = bodyIndent;
          
          while (i < lines.length) {
            const pathLine = lines[i];
            const pathTrimmed = pathLine.trim();
            
            if (pathTrimmed === '' || pathTrimmed.startsWith(';') || pathTrimmed.startsWith('#')) {
              i++;
              continue;
            }
            
            const pathIndent = getIndentLevel(pathLine);
            if (pathIndent <= pathsBaseIndent) break;
            
            // Path definition: name SCRIPT:
            const pathMatch = pathTrimmed.match(/^([a-z_][a-z0-9_]*|[A-Z][A-Za-z0-9_]*)\s+SCRIPT:?$/);
            if (pathMatch) {
              const path: BTSLScriptPath = {
                name: pathMatch[1],
                leafVersion: 192, // default
                witness: [],
                asm: []
              };
              
              i++;
              const pathDefIndent = pathIndent;
              
              while (i < lines.length) {
                const pathBodyLine = lines[i];
                const pathBodyTrimmed = pathBodyLine.trim();
                
                if (pathBodyTrimmed === '' || pathBodyTrimmed.startsWith(';') || pathBodyTrimmed.startsWith('#')) {
                  i++;
                  continue;
                }
                
                const pathBodyIndent = getIndentLevel(pathBodyLine);
                if (pathBodyIndent <= pathDefIndent) break;
                
                if (pathBodyTrimmed.startsWith('leaf_version:')) {
                  path.leafVersion = parseInt(pathBodyTrimmed.replace('leaf_version:', '').trim(), 10);
                  i++;
                  continue;
                }
                
                if (pathBodyTrimmed === 'witness:') {
                  i++;
                  const witnessBaseIndent = pathBodyIndent;
                  while (i < lines.length) {
                    const witLine = lines[i];
                    const witTrimmed = witLine.trim();
                    if (witTrimmed === '' || witTrimmed.startsWith(';') || witTrimmed.startsWith('#')) {
                      i++;
                      continue;
                    }
                    const witIndent = getIndentLevel(witLine);
                    if (witIndent <= witnessBaseIndent) break;
                    path.witness.push(witTrimmed);
                    i++;
                  }
                  continue;
                }
                
                if (pathBodyTrimmed.startsWith('asm:')) {
                  const asmInline = pathBodyTrimmed.replace('asm:', '').trim();
                  if (asmInline) {
                    path.asm = asmInline.split(/\s+/).filter(Boolean);
                  } else {
                    i++;
                    const asmBaseIndent = pathBodyIndent;
                    while (i < lines.length) {
                      const asmLine = lines[i];
                      const asmTrimmed = asmLine.trim();
                      if (asmTrimmed === '' || asmTrimmed.startsWith(';') || asmTrimmed.startsWith('#')) {
                        i++;
                        continue;
                      }
                      const asmIndent = getIndentLevel(asmLine);
                      if (asmIndent <= asmBaseIndent) break;
                      path.asm.push(...asmTrimmed.split(/\s+/).filter(Boolean));
                      i++;
                    }
                    continue;
                  }
                  i++;
                  continue;
                }
                
                i++;
              }
              
              scriptDef.paths!.push(path);
              continue;
            }
            
            i++;
          }
          continue;
        }
        
        i++;
      }
      
      scriptDefs.push(scriptDef);
      continue;
    }
    
    i++;
  }
  
  return { scriptDefs, endIdx: i };
}

// Parse INPUTS section
function parseInputs(lines: string[], startIdx: number, schemaParams: BTSLParam[]): { inputs: BTSLInput[]; endIdx: number; errors: BTSLError[] } {
  const inputs: BTSLInput[] = [];
  const errors: BTSLError[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip INPUTS: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse input line: INDEX: [NATIVE TYPE] @UTXO or UNLOCK SCRIPT...
    // Use (.*) so a bare `0:` line is valid when `utxo:` appears indented on the next line.
    const inputMatch = trimmed.match(/^(\d+):\s*(.*)$/);
    if (inputMatch) {
      const index = parseInt(inputMatch[1], 10);
      let rest = inputMatch[2].trim();
      
      const input: BTSLInput = {
        index,
        utxoRef: ''
      };
      
      // Check for NATIVE type (accept both P2TR and P2TR_KEY for convenience)
      const nativeMatch = rest.match(/^NATIVE\s+(P2PKH|P2WPKH|P2TR_KEY|P2TR)\s*/);
      if (nativeMatch) {
        const nativeType = nativeMatch[1] === 'P2TR' ? 'P2TR_KEY' : nativeMatch[1];
        input.type = `NATIVE_${nativeType}` as BTSLInput['type'];
        rest = rest.replace(nativeMatch[0], '').trim();
      }
      
      // Check for UNLOCK
      const unlockMatch = rest.match(/^UNLOCK\s+([A-Z][A-Za-z0-9_]*)(?:\s+USING\s+([a-z_][a-z0-9_]*))?:?\s*$/);
      if (unlockMatch) {
        input.scriptDef = unlockMatch[1];
        input.scriptPath = unlockMatch[2];
        
        // Parse UNLOCK body
        i++;
        const unlockBaseIndent = currentIndent;
        
        while (i < lines.length) {
          const bodyLine = lines[i];
          const bodyTrimmed = bodyLine.trim();
          
          if (bodyTrimmed === '' || bodyTrimmed.startsWith(';') || bodyTrimmed.startsWith('#')) {
            i++;
            continue;
          }
          
          const bodyIndent = getIndentLevel(bodyLine);
          if (bodyIndent <= unlockBaseIndent) break;
          
          if (bodyTrimmed.startsWith('utxo:')) {
            const utxoVal = bodyTrimmed.replace('utxo:', '').trim();
            const fromMatch = utxoVal.match(/^From\s*\(\s*(@[A-Z][A-Za-z0-9_]*)\s*\)\s+AS\s+([a-z_][a-z0-9_]*)\s*$/);
            if (fromMatch) {
              input.fromRef = fromMatch[1];
              input.utxoAlias = fromMatch[2];
              input.utxoRef = fromMatch[2];
            } else {
              const wf = parseWorkflowUtxoRef(utxoVal);
              if (wf) {
                input.workflowRef = wf.workflow;
                input.utxoRef = `@${wf.internalUtxoParam}`;
              } else {
                input.utxoRef = utxoVal;
              }
            }
            i++;
            continue;
          }
          
          if (bodyTrimmed.startsWith('sequence:')) {
            input.sequence = parseInt(bodyTrimmed.replace('sequence:', '').trim(), 10);
            i++;
            continue;
          }
          
          if (bodyTrimmed === 'script_params:') {
            input.scriptParams = {};
            i++;
            const spBaseIndent = bodyIndent;
            while (i < lines.length) {
              const spLine = lines[i];
              const spTrimmed = spLine.trim();
              if (spTrimmed === '' || spTrimmed.startsWith(';') || spTrimmed.startsWith('#')) {
                i++;
                continue;
              }
              const spIndent = getIndentLevel(spLine);
              if (spIndent <= spBaseIndent) break;
              const spMatch = spTrimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
              if (spMatch) {
                input.scriptParams[spMatch[1]] = spMatch[2].trim();
              }
              i++;
            }
            continue;
          }
          
          if (bodyTrimmed === 'witness_data:') {
            input.witnessData = {};
            i++;
            const wdBaseIndent = bodyIndent;
            while (i < lines.length) {
              const wdLine = lines[i];
              const wdTrimmed = wdLine.trim();
              if (wdTrimmed === '' || wdTrimmed.startsWith(';') || wdTrimmed.startsWith('#')) {
                i++;
                continue;
              }
              const wdIndent = getIndentLevel(wdLine);
              if (wdIndent <= wdBaseIndent) break;
              const wdMatch = wdTrimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
              if (wdMatch) {
                input.witnessData[wdMatch[1]] = wdMatch[2].trim();
              }
              i++;
            }
            continue;
          }
          
          i++;
        }
        
        // Determine type based on script def
        if (input.scriptDef && !input.type) {
          if (input.scriptPath) {
            input.type = 'UNLOCK_P2TR_SCRIPT';
          } else {
            input.type = 'UNLOCK_P2WSH';
          }
        }
        
        inputs.push(input);
        continue;
      }
      
      // Simple input with just @UTXO reference
      const utxoRefMatch = rest.match(/^(@[A-Z][A-Za-z0-9_]*)/);
      if (utxoRefMatch) {
        input.utxoRef = utxoRefMatch[1];
        i++;
        
        // Check for indented body with utxo:
        while (i < lines.length) {
          const bodyLine = lines[i];
          const bodyTrimmed = bodyLine.trim();
          
          if (bodyTrimmed === '' || bodyTrimmed.startsWith(';') || bodyTrimmed.startsWith('#')) {
            i++;
            continue;
          }
          
          const bodyIndent = getIndentLevel(bodyLine);
          if (bodyIndent <= currentIndent) break;
          
          if (bodyTrimmed.startsWith('utxo:')) {
            const utxoVal = bodyTrimmed.replace('utxo:', '').trim();
            const fromMatch = utxoVal.match(/^From\s*\(\s*(@[A-Z][A-Za-z0-9_]*)\s*\)\s+AS\s+([a-z_][a-z0-9_]*)\s*$/);
            if (fromMatch) {
              input.fromRef = fromMatch[1];
              input.utxoAlias = fromMatch[2];
              input.utxoRef = fromMatch[2];
            } else {
              const wf = parseWorkflowUtxoRef(utxoVal);
              if (wf) {
                input.workflowRef = wf.workflow;
                input.utxoRef = `@${wf.internalUtxoParam}`;
              } else {
                input.utxoRef = utxoVal;
              }
            }
          }
          i++;
        }
        
        inputs.push(input);
        continue;
      }
      
      // Check for just number followed by newline (utxo on next line)
      if (rest === '' || rest === ':') {
        i++;
        const inputBodyIndent = currentIndent;
        
        while (i < lines.length) {
          const bodyLine = lines[i];
          const bodyTrimmed = bodyLine.trim();
          
          if (bodyTrimmed === '' || bodyTrimmed.startsWith(';') || bodyTrimmed.startsWith('#')) {
            i++;
            continue;
          }
          
          const bodyIndent = getIndentLevel(bodyLine);
          if (bodyIndent <= inputBodyIndent) break;
          
          if (bodyTrimmed.startsWith('utxo:')) {
            const utxoVal = bodyTrimmed.replace('utxo:', '').trim();
            const fromMatch = utxoVal.match(/^From\s*\(\s*(@[A-Z][A-Za-z0-9_]*)\s*\)\s+AS\s+([a-z_][a-z0-9_]*)\s*$/);
            if (fromMatch) {
              input.fromRef = fromMatch[1];
              input.utxoAlias = fromMatch[2];
              input.utxoRef = fromMatch[2];
            } else {
              const wf = parseWorkflowUtxoRef(utxoVal);
              if (wf) {
                input.workflowRef = wf.workflow;
                input.utxoRef = `@${wf.internalUtxoParam}`;
              } else {
                input.utxoRef = utxoVal;
              }
            }
          }
          i++;
        }
        
        inputs.push(input);
        continue;
      }
    }
    
    i++;
  }
  
  return { inputs, endIdx: i, errors };
}

// Parse OUTPUTS section
function parseOutputs(lines: string[], startIdx: number): { outputs: BTSLOutput[]; endIdx: number } {
  const outputs: BTSLOutput[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip OUTPUTS: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse output line
    const outputMatch = trimmed.match(/^(\d+):\s*(.+)$/);
    if (outputMatch) {
      const index = parseInt(outputMatch[1], 10);
      const rest = outputMatch[2].trim();
      
      // OP_RETURN output
      const opReturnMatch = rest.match(/^OP_RETURN\s+(.+)$/);
      if (opReturnMatch) {
        outputs.push({
          index,
          type: 'OP_RETURN',
          payload: opReturnMatch[1].trim()
        });
        i++;
        continue;
      }
      
      // CHANGE output: CHANGE @PARAM.address var_name [sats] or CHANGE utxo_alias.address var_name [sats]
      const changeMatch = rest.match(/^CHANGE\s+((?:@[A-Z][A-Za-z0-9_]*|[a-z_][a-z0-9_]*)(?:\.[a-z]+)?)\s+([a-z_][a-z0-9_]*)(?:\s+sats)?$/);
      if (changeMatch) {
        outputs.push({
          index,
          type: 'CHANGE',
          address: changeMatch[1],
          amountVar: changeMatch[2]
        });
        i++;
        continue;
      }
      
      // SCRIPT output: SCRIPT NAME amount sats (literal, calc var, or @PARAM e.g. @VAULT_AMOUNT)
      const scriptMatch = rest.match(
        /^SCRIPT\s+([A-Z][A-Za-z0-9_]*)\s+(\d+|@[A-Z][A-Za-z0-9_]*|[a-z_][a-z0-9_]*)\s*sats?$/
      );
      if (scriptMatch) {
        const output: BTSLOutput = {
          index,
          type: 'SCRIPT',
          scriptDef: scriptMatch[1],
          amount: scriptMatch[2].match(/^\d+$/) ? parseInt(scriptMatch[2], 10) : undefined,
          amountVar: scriptMatch[2].match(/^\d+$/) ? undefined : scriptMatch[2]
        };
        
        // Check for script_params on following lines
        i++;
        const scriptBaseIndent = currentIndent;
        while (i < lines.length) {
          const bodyLine = lines[i];
          const bodyTrimmed = bodyLine.trim();
          
          if (bodyTrimmed === '' || bodyTrimmed.startsWith(';') || bodyTrimmed.startsWith('#')) {
            i++;
            continue;
          }
          
          const bodyIndent = getIndentLevel(bodyLine);
          if (bodyIndent <= scriptBaseIndent) break;
          
          if (bodyTrimmed === 'script_params:') {
            output.scriptParams = {};
            i++;
            const spBaseIndent = bodyIndent;
            while (i < lines.length) {
              const spLine = lines[i];
              const spTrimmed = spLine.trim();
              if (spTrimmed === '' || spTrimmed.startsWith(';') || spTrimmed.startsWith('#')) {
                i++;
                continue;
              }
              const spIndent = getIndentLevel(spLine);
              if (spIndent <= spBaseIndent) break;
              const spMatch = spTrimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
              if (spMatch) {
                output.scriptParams[spMatch[1]] = spMatch[2].trim();
              }
              i++;
            }
            continue;
          }
          i++;
        }
        
        outputs.push(output);
        continue;
      }
      
      // ADDRESS output with constant name (e.g. PAYMENT_ADDRESS AMOUNT sats)
      const constAddrMatch = rest.match(/^([A-Z_][A-Z0-9_]*)\s+(\d+|@[A-Z][A-Za-z0-9_]*|[a-z_][a-z0-9_]*|[A-Z_][A-Z0-9_]*)\s*(sats|btc)?$/);
      if (constAddrMatch) {
        const amountStr = constAddrMatch[2];
        const isLiteralNumber = /^\d+$/.test(amountStr);
        const isParamRef = /^@[A-Z]/.test(amountStr);
        outputs.push({
          index,
          type: 'ADDRESS',
          address: constAddrMatch[1],
          amount: isLiteralNumber ? parseInt(amountStr, 10) : undefined,
          amountVar: isLiteralNumber ? undefined : amountStr,
          amountIsParam: isParamRef
        });
        i++;
        continue;
      }

      // Regular ADDRESS output: @ADDRESS amount [unit] or @ADDRESS var_name sats or @ADDRESS @PARAM sats
      const addrMatch = rest.match(/^(@[A-Z][A-Za-z0-9_]*(?:\.[a-z]+)?|"[^"]+")\s+(\d+|@[A-Z][A-Za-z0-9_]*|[a-z_][a-z0-9_]*)\s*(sats|btc)?$/);
      if (addrMatch) {
        const amountStr = addrMatch[2];
        const unit = addrMatch[3] || 'sats';
        
        // Check if amount is a literal number, param reference (@PARAM), or calc variable
        const isLiteralNumber = /^\d+$/.test(amountStr);
        const isParamRef = /^@[A-Z]/.test(amountStr);
        
        outputs.push({
          index,
          type: 'ADDRESS',
          address: addrMatch[1],
          amount: isLiteralNumber 
            ? (unit === 'btc' ? parseInt(amountStr, 10) * 100_000_000 : parseInt(amountStr, 10))
            : undefined,
          amountVar: isLiteralNumber ? undefined : amountStr,
          amountIsParam: isParamRef // Track if amount is a param reference
        });
        i++;
        continue;
      }
    }
    
    i++;
  }
  
  return { outputs, endIdx: i };
}

// Parse calc section
function parseCalc(lines: string[], startIdx: number): { calc: BTSLCalcAssignment[]; endIdx: number } {
  const calc: BTSLCalcAssignment[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip calc: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse calc assignment: var = expression
    const calcMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/);
    if (calcMatch) {
      calc.push({
        variable: calcMatch[1],
        expression: calcMatch[2].trim()
      });
    }
    
    i++;
  }
  
  return { calc, endIdx: i };
}

// Parse ASSERT section
function parseAsserts(lines: string[], startIdx: number): { asserts: BTSLAssertion[]; endIdx: number; warnings: BTSLWarning[] } {
  const asserts: BTSLAssertion[] = [];
  const warnings: BTSLWarning[] = [];
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip ASSERT: line
  
  let lastIndex = -1;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse assert: INDEX: condition
    const assertMatch = trimmed.match(/^(\d+):\s*(.+)$/);
    if (assertMatch) {
      const index = parseInt(assertMatch[1], 10);
      const condition = assertMatch[2].trim();
      
      // Check for non-sequential indices
      if (lastIndex >= 0 && index !== lastIndex + 1) {
        warnings.push({
          code: 'BTSL_WARN_02',
          message: `Non-sequential ASSERT indices: expected ${lastIndex + 1}, got ${index}`,
          line: i + 1
        });
      }
      lastIndex = index;
      
      asserts.push({
        index,
        condition,
        source: trimmed
      });
    }
    
    i++;
  }
  
  return { asserts, endIdx: i, warnings };
}

// Parse OPTIONS section
function parseOptions(lines: string[], startIdx: number): { options: { dependsOn?: string; [key: string]: string | undefined }; endIdx: number } {
  const options: { dependsOn?: string; [key: string]: string | undefined } = {};
  let i = startIdx;
  const baseIndent = getIndentLevel(lines[startIdx]);
  i++; // Skip OPTIONS: line
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse DEPENDS_ON
    const dependsMatch = trimmed.match(/^DEPENDS_ON\s+([A-Z][A-Za-z0-9_]*)$/);
    if (dependsMatch) {
      options.dependsOn = dependsMatch[1];
      i++;
      continue;
    }
    
    // Parse other options
    const optMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (optMatch) {
      options[optMatch[1]] = optMatch[2].trim();
    }
    
    i++;
  }
  
  return { options, endIdx: i };
}

// Parse PSBT_SCHEMA
function parseSchema(lines: string[], startIdx: number): { schema: BTSLSchema; endIdx: number; errors: BTSLError[]; warnings: BTSLWarning[] } {
  const errors: BTSLError[] = [];
  const warnings: BTSLWarning[] = [];
  
  const headerMatch = lines[startIdx].trim().match(/^PSBT_SCHEMA\s+([A-Z][A-Za-z0-9_]*):?$/);
  if (!headerMatch) {
    errors.push({
      code: 'BTSL_ERR_00',
      message: 'Invalid PSBT_SCHEMA header',
      line: startIdx + 1
    });
    return {
      schema: { name: '', params: [], inputs: [], outputs: [], calc: [], asserts: [] },
      endIdx: startIdx + 1,
      errors,
      warnings
    };
  }
  
  const schema: BTSLSchema = {
    name: headerMatch[1],
    params: [],
    inputs: [],
    outputs: [],
    calc: [],
    asserts: []
  };
  
  const baseIndent = getIndentLevel(lines[startIdx]);
  let i = startIdx + 1;
  
  let hasInputs = false;
  let hasOutputs = false;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= baseIndent) break;
    
    // Parse PARAMS inside schema
    if (trimmed === 'PARAMS:' || trimmed.startsWith('PARAMS:')) {
      const { params: localParams, warnings: paramWarnings } = extractParams(lines.slice(i).join('\n'));
      schema.params = localParams;
      warnings.push(...paramWarnings);
      // Skip to next section
      i++;
      while (i < lines.length) {
        const pLine = lines[i];
        const pTrimmed = pLine.trim();
        if (pTrimmed === '' || pTrimmed.startsWith(';') || pTrimmed.startsWith('#') || pTrimmed.startsWith('@')) {
          i++;
          continue;
        }
        const pIndent = getIndentLevel(pLine);
        if (pIndent <= currentIndent) break;
        i++;
      }
      continue;
    }
    
    // Parse schema-level CONST
    if (trimmed === 'CONST:') {
      const { consts: schemaConsts, endIdx } = parseConsts(lines, i);
      schema.consts = schemaConsts;
      i = endIdx;
      continue;
    }

    // Parse OPTIONS
    if (trimmed === 'OPTIONS:') {
      const { options, endIdx } = parseOptions(lines, i);
      schema.options = options;
      i = endIdx;
      continue;
    }

    // Spec §9.4: DEPENDS_ON may appear as a schema-body declaration (not only under OPTIONS:)
    const bareDepends = trimmed.match(/^DEPENDS_ON\s+([A-Z][A-Za-z0-9_]*)$/);
    if (bareDepends) {
      schema.options = { ...schema.options, dependsOn: bareDepends[1] };
      i++;
      continue;
    }
    
    // Parse INPUTS
    if (trimmed === 'INPUTS:') {
      const { inputs, endIdx, errors: inputErrors } = parseInputs(lines, i, schema.params);
      schema.inputs = inputs;
      errors.push(...inputErrors);
      hasInputs = true;
      i = endIdx;
      continue;
    }
    
    // Parse OUTPUTS
    if (trimmed === 'OUTPUTS:') {
      const { outputs, endIdx } = parseOutputs(lines, i);
      schema.outputs = outputs;
      hasOutputs = true;
      i = endIdx;
      continue;
    }
    
    // Parse calc
    if (trimmed === 'calc:') {
      const { calc, endIdx } = parseCalc(lines, i);
      schema.calc = calc;
      i = endIdx;
      continue;
    }
    
    // Parse ASSERT
    if (trimmed === 'ASSERT:') {
      const { asserts, endIdx, warnings: assertWarnings } = parseAsserts(lines, i);
      schema.asserts = asserts;
      warnings.push(...assertWarnings);
      i = endIdx;
      continue;
    }
    
    i++;
  }
  
  // Validate required sections
  if (!hasInputs) {
    errors.push({
      code: 'BTSL_ERR_00',
      message: 'INPUTS section is required',
      line: startIdx + 1
    });
  }
  if (!hasOutputs) {
    errors.push({
      code: 'BTSL_ERR_00',
      message: 'OUTPUTS section is required',
      line: startIdx + 1
    });
  }
  
  return { schema, endIdx: i, errors, warnings };
}

// Main parser function
export function parseBTSL(content: string): ParseResult {
  const errors: BTSLError[] = [];
  const warnings: BTSLWarning[] = [];
  
  const lines = tokenizeLines(content);
  
  // Check indentation
  const indentError = checkIndentation(lines);
  if (indentError) {
    return { success: false, errors: [indentError], warnings };
  }
  
  // Parse VERSION
  const versionResult = parseVersion(lines);
  if ('code' in versionResult) {
    return { success: false, errors: [versionResult], warnings };
  }
  
  const document: BTSLDocument = {
    version: versionResult.version,
    consts: [],
    scriptDefs: [],
    schemas: []
  };
  
  // Check version
  if (document.version > 1) {
    errors.push({
      code: 'BTSL_ERR_00',
      message: `Unsupported version: ${document.version}. Maximum supported version is 1.`,
      line: versionResult.lineIndex + 1
    });
    return { success: false, errors, warnings };
  }
  
  // Extract all params first (Phase 0.2)
  const { params: allParams, warnings: paramWarnings } = extractParams(content);
  warnings.push(...paramWarnings);
  
  let i = versionResult.lineIndex + 1;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    // Parse CONST section
    if (trimmed === 'CONST:') {
      const { consts, endIdx } = parseConsts(lines, i);
      document.consts = consts;
      i = endIdx;
      continue;
    }
    
    // Parse top-level PARAMS section
    if (trimmed === 'PARAMS:' || trimmed.startsWith('PARAMS:')) {
      // Skip - already extracted
      i++;
      while (i < lines.length) {
        const pLine = lines[i];
        const pTrimmed = pLine.trim();
        if (pTrimmed === '' || pTrimmed.startsWith(';') || pTrimmed.startsWith('#') || pTrimmed.startsWith('@')) {
          i++;
          continue;
        }
        const pIndent = getIndentLevel(pLine);
        if (pIndent === 0) break;
        i++;
      }
      continue;
    }
    
    // Parse SCRIPT_DEFS section
    if (trimmed === 'SCRIPT_DEFS:') {
      const { scriptDefs, endIdx } = parseScriptDefs(lines, i);
      document.scriptDefs = scriptDefs;
      i = endIdx;
      continue;
    }
    
    // Parse PSBT_SCHEMA
    if (trimmed.startsWith('PSBT_SCHEMA')) {
      const { schema, endIdx, errors: schemaErrors, warnings: schemaWarnings } = parseSchema(lines, i);
      document.schemas.push(schema);
      errors.push(...schemaErrors);
      warnings.push(...schemaWarnings);
      i = endIdx;
      continue;
    }
    
    // Handle reserved sections (FOREACH, IMPORT)
    if (trimmed.startsWith('FOREACH') || trimmed.startsWith('IMPORT')) {
      warnings.push({
        code: 'BTSL_WARN_01',
        message: `Reserved section "${trimmed.split(' ')[0]}" ignored`,
        line: i + 1
      });
      i++;
      continue;
    }
    
    i++;
  }
  
  // Validate we have at least one schema
  if (document.schemas.length === 0) {
    errors.push({
      code: 'BTSL_ERR_00',
      message: 'At least one PSBT_SCHEMA is required',
      line: 1
    });
  }
  
  // Merge params from all schemas and add derived params (From(@X) AS alias)
  const mergedParams = [...allParams];
  for (const schema of document.schemas) {
    for (const param of schema.params) {
      if (!mergedParams.find(p => p.name === param.name)) {
        mergedParams.push(param);
      }
    }
    for (const input of schema.inputs) {
      if (input.utxoAlias && !mergedParams.find(p => p.name === input.utxoAlias)) {
        mergedParams.push({ name: input.utxoAlias, type: 'UTXO' });
      }
      if (input.workflowRef) {
        const internalName = input.utxoRef.replace(/^@/, '');
        if (internalName && !mergedParams.find(p => p.name === internalName)) {
          mergedParams.push({ name: internalName, type: 'UTXO' });
        }
      }
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors, warnings, params: mergedParams };
  }
  
  return { 
    success: true, 
    document, 
    params: mergedParams,
    errors: [], 
    warnings 
  };
}

// Validate bound parameters (Phase 2)
export function validateBoundParams(
  params: BTSLParam[],
  values: Record<string, string>,
  options?: { payloadParamNames?: string[] }
): { valid: boolean; errors: BTSLError[]; warnings: BTSLWarning[] } {
  const errors: BTSLError[] = [];
  const warnings: BTSLWarning[] = [];
  const payloadParamNames = options?.payloadParamNames ?? [];

  for (const param of params) {
    const value = values[param.name];

    if (value === undefined || value === '') {
      errors.push({
        code: 'BTSL_ERR_04b',
        message: `Missing value for @${param.name}`
      });
      continue;
    }

    // Type-specific validation
    switch (param.type) {
      case 'UTXO':
        // Should be in format txid:vout
        if (!value.match(/^[0-9a-fA-F]{64}:\d+$/)) {
          errors.push({
            code: 'BTSL_ERR_00',
            message: `Invalid UTXO format for @${param.name}: expected txid:vout (64 hex chars:number)`
          });
        }
        break;
        
      case 'ADDRESS':
        // Basic Bitcoin address validation
        if (!value.match(/^(bc1|tb1|[13mn])[a-zA-HJ-NP-Z0-9]{25,90}$/)) {
          errors.push({
            code: 'BTSL_ERR_00',
            message: `Invalid Bitcoin address format for @${param.name}`
          });
        }
        break;
        
      case 'FEERATE':
        const feeRate = parseFloat(value);
        if (isNaN(feeRate) || feeRate <= 0) {
          errors.push({
            code: 'BTSL_ERR_00',
            message: `Invalid fee rate for @${param.name}: must be positive number`
          });
        }
        break;
        
      case 'HEX_DATA':
        // OP_RETURN payload params accept any string (hex or text; conversion handled at build time)
        if (!payloadParamNames.includes(param.name) && !value.match(/^(0x)?[0-9a-fA-F]+$/)) {
          errors.push({
            code: 'BTSL_ERR_00',
            message: `Invalid hex data format for @${param.name}`
          });
        }
        break;
        
      case 'SATOSHI':
        const satValue = parseInt(value, 10);
        if (isNaN(satValue) || satValue < 0) {
          errors.push({
            code: 'BTSL_ERR_00',
            message: `Invalid satoshi value for @${param.name}: must be non-negative integer`
          });
        }
        break;
        
      case 'PUBKEY':
        if (!value.match(/^(0x)?[0-9a-fA-F]{66}$/)) {
          errors.push({
            code: 'BTSL_ERR_04e',
            message: `Invalid pubkey for @${param.name}: must be 33-byte compressed (66 hex chars)`
          });
        }
        break;

      case 'UNTYPED':
        warnings.push({
          code: 'BTSL_WARN_03',
          message: `@${param.name} is untyped, flexible mode applied`
        });
        break;
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}
