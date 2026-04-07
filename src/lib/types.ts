export interface Discrepancy {
  timestamp: string;
  originalText: string;
  correctedText: string;
  significance: "קריטי" | "בינוני" | "נמוך";
  explanation: string;
}

export interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
}

export interface AnalysisStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "error";
  errorMessage?: string;
}
