'use client';

import { useEffect, useState } from 'react';

const VISITED_KEY = 'btsl_visited';
const EXPERIENCED_KEY = 'btsl_experienced';
const SUCCESSFUL_RUNS_KEY = 'btsl_successful_runs';

export interface FirstVisitState {
  isFirstVisit: boolean;
  isExperienced: boolean;
  successfulRuns: number;
  loaded: boolean;
  markExperienced: () => void;
  incrementSuccessfulRuns: () => void;
}

export function useFirstVisit(): FirstVisitState {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [isExperienced, setIsExperienced] = useState(false);
  const [successfulRuns, setSuccessfulRuns] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const visited = localStorage.getItem(VISITED_KEY);
    const experienced = localStorage.getItem(EXPERIENCED_KEY);
    const runs = parseInt(localStorage.getItem(SUCCESSFUL_RUNS_KEY) ?? '0', 10);

    setIsFirstVisit(!visited);
    setIsExperienced(Boolean(experienced));
    setSuccessfulRuns(runs);
    setLoaded(true);

    localStorage.setItem(VISITED_KEY, '1');
  }, []);

  const markExperienced = () => {
    localStorage.setItem(EXPERIENCED_KEY, '1');
    setIsExperienced(true);
  };

  const incrementSuccessfulRuns = () => {
    const newCount = successfulRuns + 1;
    localStorage.setItem(SUCCESSFUL_RUNS_KEY, String(newCount));
    setSuccessfulRuns(newCount);
    if (newCount >= 3) {
      markExperienced();
    }
  };

  return { isFirstVisit, isExperienced, successfulRuns, loaded, markExperienced, incrementSuccessfulRuns };
}
