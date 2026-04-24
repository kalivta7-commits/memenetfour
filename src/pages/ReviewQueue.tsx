// ReviewQueue has been replaced by the AI auto-pipeline.
// This component just redirects to My Tokens so old links don't break.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function ReviewQueue() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/my-tokens', { replace: true }); }, [navigate]);
  return null;
}
