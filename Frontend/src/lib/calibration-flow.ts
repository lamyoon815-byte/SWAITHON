import { CALIBRATION } from '@/assets/images/calibration';
import type { CalibrationColorType, CalibrationResult } from '@/types/calibration';

export type CalibrationPhase = 'screening' | 'manual' | 'color' | 'color-choice' | 'edge' | 'contrast' | 'complete';
export type CalibrationState = {
  phase: CalibrationPhase;
  index: number;
  answers: string[];
  result: CalibrationResult;
};
export type CalibrationAction = { type: 'answer'; value: string } | { type: 'choose'; value: CalibrationColorType } | { type: 'strength'; value: number } | { type: 'skip' };

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
      case 'color': case 'color-choice': return next(state, 'edge', { severity: 0 });
      case 'edge': return next(state, 'contrast', { edge: 0 });
      case 'contrast': return next(state, 'complete', { contrast: 1 });
      default: return state;
    }
  }
  if (state.phase === 'manual' && action.type === 'choose') {
    if (!['normal', 'protan', 'deutan', 'tritan'].includes(action.value)) return state;
    return next(state, action.value === 'normal' ? 'edge' : 'color', { color_type: action.value, severity: 0 });
  }
  if (state.phase === 'color-choice' && action.type === 'strength' && state.result.color_type !== 'normal') {
    const levels = CALIBRATION.color[state.result.color_type].levels;
    if (action.value !== 0 && !levels.includes(action.value)) return state;
    return next(state, 'edge', { severity: action.value });
  }
  if (action.type !== 'answer') return state;
  if (state.phase === 'screening') {
    const plate = CALIBRATION.screening.plates[state.index];
    if (!plate?.choices.includes(action.value)) return state;
    const answers = [...state.answers, action.value];
    if (answers.length < CALIBRATION.screening.plates.length) return { ...state, index: state.index + 1, answers };
    // 결과가 분명하면(다 맞힘·한 종류만 틀림 등) 고르는 화면 없이 바로 다음 단계로 간다.
    // 애매할 때만 'manual'에서 보정한 그림을 비교해 고른다(색약이면 어떤 색이 어려운지 스스로 알기 어렵다).
    const suggestion = screeningSuggestion(answers);
    if (suggestion === null) return { ...state, phase: 'manual', index: 0, answers };
    return next({ ...state, answers }, suggestion === 'normal' ? 'edge' : 'color', { color_type: suggestion, severity: 0 });
  }
  if (state.phase === 'color' && state.result.color_type !== 'normal') {
    const series = CALIBRATION.color[state.result.color_type];
    const plate = series.plates[state.index];
    if (!plate?.choices.includes(action.value)) return state;
    if (action.value === plate.answer) return next(state, 'edge', { severity: series.levels[state.index] });
    // 숫자를 끝까지 못 읽어도 보정을 끄지 않고, 작품을 비교해 직접 강도를 고르게 한다.
    return state.index === series.levels.length - 1
      ? next(state, 'color-choice') : { ...state, index: state.index + 1 };
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
