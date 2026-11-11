import { CALIBRATION } from '@/assets/images/calibration';
import type { CalibrationColorType, CalibrationResult } from '@/types/calibration';

export type CalibrationPhase = 'screening' | 'manual' | 'color' | 'edge' | 'contrast' | 'complete';
export type CalibrationState = {
  phase: CalibrationPhase;
  index: number;
  answers: string[];
  result: CalibrationResult;
};
export type CalibrationAction = { type: 'answer'; value: string } | { type: 'choose'; value: CalibrationColorType } | { type: 'skip' };

export function initialCalibration(): CalibrationState {
  return { phase: 'screening', index: 0, answers: [], result: { color_type: 'normal', severity: 0, edge: 0, contrast: 1 } };
}

/** 문서에 없는 혼합 결과도 자동 분류하지 않고 직접 선택으로 보낸다. */
export function screeningSuggestion(answers: string[]): CalibrationColorType | null {
  if (answers.length !== CALIBRATION.screening.plates.length) return null;
  const wrong = CALIBRATION.screening.plates.filter((plate, index) => answers[index] !== plate.answer).map((plate) => plate.color_type);
  if (wrong.length === 0) return 'normal';
  if (wrong.length === 1) return wrong[0];
  if (wrong.length === 2 && !wrong.includes('tritan')) return 'deutan';
  return null;
}

function next(state: CalibrationState, phase: CalibrationPhase, patch: Partial<CalibrationResult> = {}): CalibrationState {
  return { ...state, phase, index: 0, result: { ...state.result, ...patch } };
}

/** 순수 전이 함수. 뒤로 가기는 화면에서 이전 상태를 복원하여 이후 응답을 버린다. */
export function advanceCalibration(state: CalibrationState, action: CalibrationAction): CalibrationState {
  if (action.type === 'skip') {
    switch (state.phase) {
      case 'screening': case 'manual': return next(state, 'edge', { color_type: 'normal', severity: 0 });
      case 'color': return next(state, 'edge', { severity: 0 });
      case 'edge': return next(state, 'contrast', { edge: 0 });
      case 'contrast': return next(state, 'complete', { contrast: 1 });
      default: return state;
    }
  }
  if (state.phase === 'manual' && action.type === 'choose') {
    if (!['normal', 'protan', 'deutan', 'tritan'].includes(action.value)) return state;
    return next(state, action.value === 'normal' ? 'edge' : 'color', { color_type: action.value, severity: 0 });
  }
  if (action.type !== 'answer') return state;
  if (state.phase === 'screening') {
    const plate = CALIBRATION.screening.plates[state.index];
    if (!plate?.choices.includes(action.value)) return state;
    const answers = [...state.answers, action.value];
    return answers.length === CALIBRATION.screening.plates.length
      ? { ...state, phase: 'manual', index: 0, answers }
      : { ...state, index: state.index + 1, answers };
  }
  if (state.phase === 'color' && state.result.color_type !== 'normal') {
    const series = CALIBRATION.color[state.result.color_type];
    const plate = series.plates[state.index];
    if (!plate?.choices.includes(action.value)) return state;
    if (action.value === plate.answer) return next(state, 'edge', { severity: series.levels[state.index] });
    // 마지막까지 보이지 않은 강도를 개인 맞춤값(최댓값)으로 확정하지 않는다.
    return state.index === series.levels.length - 1
      ? next(state, 'edge', { severity: 0 }) : { ...state, index: state.index + 1 };
  }
  if (state.phase === 'edge' || state.phase === 'contrast') {
    if (!['visible', 'not-visible'].includes(action.value)) return state;
    const series = CALIBRATION[state.phase];
    if (action.value === 'visible') {
      return state.phase === 'edge'
        ? next(state, 'contrast', { edge: series.levels[state.index] })
        : next(state, 'complete', { contrast: series.levels[state.index] });
    }
    if (state.index === series.levels.length - 1) {
      return state.phase === 'edge' ? next(state, 'contrast', { edge: 0 }) : next(state, 'complete', { contrast: 1 });
    }
    return { ...state, index: state.index + 1 };
  }
  return state;
}
