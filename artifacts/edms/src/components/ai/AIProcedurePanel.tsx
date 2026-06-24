// AI is currently disabled (VITE_AI_ENABLED is not set).
// To restore AI-powered procedure suggestions:
//   1. Set VITE_AI_ENABLED=true in .env
//   2. Implement the AI backend endpoints
//   3. Replace this stub with the real AIProcedurePanel component

export interface AIProcedureSuggestion {
  documentNumber?: string;
  discipline?: string;
  documentType?: string;
  revision?: string;
  title?: string;
}

interface AIProcedurePanelProps {
  projectId: number;
  projectCode?: string;
  projectName?: string;
  discipline?: string;
  documentType?: string;
  partialTitle?: string;
  onApply: (suggestion: AIProcedureSuggestion) => void;
}

export function AIProcedurePanel(_props: AIProcedurePanelProps): null {
  return null;
}
