/** A flagged zone in the PDF text that needs human review */
export interface Discrepancy {
  timestamp: string;
  /** The original text from the PDF protocol */
  originalText: string;
  /** Human-entered correction after listening to audio */
  correctedText: string;
  significance: "קריטי" | "בינוני" | "נמוך";
  /** AI-generated explanation of why this zone is suspicious */
  explanation: string;
  /** AI-assigned risk score */
  riskScore?: "high" | "medium" | "low";
  /** Category of suspicion */
  riskReason?: string;
  /** Has a human reviewed and verified/corrected this row? */
  humanVerified?: boolean;
  /** Free-form auditor notes */
  auditorNotes?: string;
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
