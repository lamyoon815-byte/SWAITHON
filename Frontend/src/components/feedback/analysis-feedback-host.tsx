import { useEffect, useState } from 'react';

import { FeedbackSheet } from '@/components/feedback/feedback-sheet';
import { getPalette } from '@/constants/a11y';
import { useProfile } from '@/hooks/use-profile';
import { takePendingFeedback, type PendingFeedback } from '@/lib/pending-feedback';

/** 미등록 해설에서 나왔을 때 홈뿐 아니라 카메라·재촬영 화면에서도 설문을 띄운다. */
export function AnalysisFeedbackHost({ pathname }: { pathname: string }) {
  const { profile } = useProfile();
  const [feedback, setFeedback] = useState<PendingFeedback | null>(null);
  useEffect(() => {
    if (pathname === '/analysis') return;
    // 화면 전환 다음 프레임에 표시한다. 전환이 취소되면 설문을 꺼내지 않는다.
    const frame = requestAnimationFrame(() => {
      const next = takePendingFeedback('analysis');
      if (next) setFeedback(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  if (!feedback) return null;
  return <FeedbackSheet key={feedback.analysisId} item={feedback}
    palette={getPalette('dark', profile.high_contrast)} onClose={() => setFeedback(null)} />;
}
