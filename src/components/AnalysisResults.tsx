"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Play,
  AlertTriangle,
  AlertCircle,
  Info,
  FileCheck,
  Save,
  Check,
  Loader2,
  FileDown,
  Flame,
  ShieldCheck,
  SkipForward,
  ArrowLeftRight,
  Undo2,
  Redo2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Discrepancy } from "@/lib/types";

interface AnalysisResultsProps {
  discrepancies: Discrepancy[];
  currentAudioTime?: number;
  onTimestampClick?: (timestamp: string) => void;
  onDiscrepanciesChange?: (discrepancies: Discrepancy[]) => void;
  onSave?: (discrepancies: Discrepancy[]) => Promise<void>;
  onExportDocx?: (discrepancies: Discrepancy[]) => void;
}

const riskConfig = {
  high: { label: "קריטי", color: "text-rose border-rose/40 bg-rose/10", icon: Flame, heatBg: "bg-rose/[0.08]", heatBorder: "border-rose/30" },
  medium: { label: "אזהרה", color: "text-amber border-amber/40 bg-amber/10", icon: AlertTriangle, heatBg: "bg-amber/[0.05]", heatBorder: "border-amber/30" },
  low: { label: "נמוך", color: "text-muted-foreground border-border bg-muted/50", icon: Info, heatBg: "", heatBorder: "border-border" },
} as const;

const RISK_REASON_LABELS: Record<string, string> = {
  morphologicalMismatch: "אי-התאמה מורפולוגית (ת/תי/ה)",
  legalHallucination: "הזיה משפטית — מילה לא במקום",
  negationFlag: "⚠ שלילה/אישור — בדיקה חובה",
  speakerOverlap: "חפיפת דוברים / קיפול הפרעה",
  speakerFatigue: "בלוק ארוך — חשד להחלפת דובר",
  properNameWatch: "שם/מספר — בדיקה חובה",
  gibberish: "מילה לא קיימת",
  syntaxCollapse: "קריסת תחביר",
  smoothing: "החלקת עדות",
  semanticGap: "פער סמנטי",
  stylistic: "סגנון חריג",
  speakerMismatch: "שיוך דובר חשוד",
  phoneticSuspect: "דמיון פונטי",
};

function timestampToSeconds(ts: string): number {
  const p = ts.split(":").map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

// ── Undo/Redo history hook ──────────────────────────────────────────
function useHistory<T>(initial: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);
  const initialized = useRef(false);

  // Sync when external discrepancies change (initial load / auto-save)
  useEffect(() => {
    if (!initialized.current) {
      setPresent(initial);
      initialized.current = true;
    }
  }, [initial]);

  const push = useCallback((newState: T) => {
    setPast((p) => [...p.slice(-30), present]); // keep last 30
    setPresent(newState);
    setFuture([]);
  }, [present]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture((f) => [present, ...f]);
    setPresent(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, present]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast((p) => [...p, present]);
    setPresent(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, present]);

  return { state: present, push, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export default function AnalysisResults({
  discrepancies: externalDiscrepancies,
  currentAudioTime = 0,
  onTimestampClick,
  onDiscrepanciesChange,
  onSave,
  onExportDocx,
}: AnalysisResultsProps) {
  const { state: discrepancies, push, undo, redo, canUndo, canRedo } =
    useHistory(externalDiscrepancies);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Propagate changes up
  useEffect(() => {
    if (discrepancies !== externalDiscrepancies) {
      onDiscrepanciesChange?.(discrepancies);
    }
  }, [discrepancies, externalDiscrepancies, onDiscrepanciesChange]);

  // Keyboard undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault(); redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const activeRowIndex = (() => {
    if (currentAudioTime <= 0) return -1;
    for (let i = discrepancies.length - 1; i >= 0; i--) {
      if (currentAudioTime >= timestampToSeconds(discrepancies[i].timestamp)) return i;
    }
    return -1;
  })();

  const highRiskIndices = useMemo(
    () => discrepancies.map((d, i) => (d.riskScore === "high" && !d.humanVerified ? i : -1)).filter((i) => i >= 0),
    [discrepancies]
  );

  const jumpToNextHighRisk = useCallback(() => {
    if (highRiskIndices.length === 0) return;
    const cur = activeRowIndex >= 0 ? activeRowIndex : -1;
    const next = highRiskIndices.find((i) => i > cur) ?? highRiskIndices[0];
    onTimestampClick?.(discrepancies[next].timestamp);
    document.getElementById(`result-row-${next}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highRiskIndices, activeRowIndex, discrepancies, onTimestampClick]);

  const updateRow = useCallback(
    (index: number, updates: Partial<Discrepancy>) => {
      const updated = discrepancies.map((d, i) => (i === index ? { ...d, ...updates } : d));
      push(updated);
      setHasUnsavedChanges(true);
    },
    [discrepancies, push]
  );

  const swapSpeaker = useCallback(
    (index: number) => {
      const item = discrepancies[index];
      const text = item.originalText;
      // Try to detect and swap speaker prefix (e.g., "השופט:" → "עו"ד:")
      const speakerPattern = /^(השופט|עו"ד|העד|הנאשם|התובע|ב"כ התביעה|ב"כ ההגנה|הרשם)(\s*:?\s*)/;
      const match = text.match(speakerPattern);
      if (match) {
        const speakers = ["השופט", "עו\"ד", "העד", "הנאשם", "התובע"];
        const currentSpeaker = match[1];
        const currentIdx = speakers.indexOf(currentSpeaker);
        const nextSpeaker = speakers[(currentIdx + 1) % speakers.length];
        const swapped = text.replace(speakerPattern, `${nextSpeaker}${match[2]}`);
        updateRow(index, { correctedText: swapped, humanVerified: true, auditorNotes: `החלפת דובר: ${currentSpeaker} → ${nextSpeaker}` });
      } else {
        updateRow(index, { auditorNotes: (item.auditorNotes || "") + " [החלפת דובר נדרשת]", humanVerified: true });
      }
    },
    [discrepancies, updateRow]
  );

  const handleSaveAll = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onSave(discrepancies);
      setSaveSuccess(true);
      setHasUnsavedChanges(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, discrepancies]);

  useEffect(() => {
    if (activeRowIndex >= 0) {
      document.getElementById(`result-row-${activeRowIndex}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeRowIndex]);

  if (discrepancies.length === 0) {
    return (
      <Card className="border-emerald/30 bg-emerald/5">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="rounded-2xl bg-emerald/10 p-4"><FileCheck className="h-10 w-10 text-emerald" /></div>
          <div className="text-center">
            <h3 className="text-xl font-bold text-foreground">לא נמצאו אזורים חשודים</h3>
            <p className="mt-2 text-muted-foreground">הפרוטוקול נראה תקין</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const highCount = discrepancies.filter((d) => d.riskScore === "high").length;
  const medCount = discrepancies.filter((d) => d.riskScore === "medium").length;
  const verifiedCount = discrepancies.filter((d) => d.humanVerified).length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="border-rose/20 bg-rose/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-rose/10 p-2"><Flame className="h-5 w-5 text-rose" /></div>
            <div><p className="text-2xl font-bold text-rose">{highCount}</p><p className="text-xs text-muted-foreground">קריטי</p></div>
          </CardContent>
        </Card>
        <Card className="border-amber/20 bg-amber/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber/10 p-2"><AlertCircle className="h-5 w-5 text-amber" /></div>
            <div><p className="text-2xl font-bold text-amber">{medCount}</p><p className="text-xs text-muted-foreground">אזהרה</p></div>
          </CardContent>
        </Card>
        <Card className="border-emerald/20 bg-emerald/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-emerald/10 p-2"><Info className="h-5 w-5 text-emerald" /></div>
            <div><p className="text-2xl font-bold text-emerald">{discrepancies.length - highCount - medCount}</p><p className="text-xs text-muted-foreground">נמוך</p></div>
          </CardContent>
        </Card>
        <Card className="border-indigo/20 bg-indigo/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-indigo/10 p-2"><ShieldCheck className="h-5 w-5 text-indigo" /></div>
            <div><p className="text-2xl font-bold text-indigo">{verifiedCount}/{discrepancies.length}</p><p className="text-xs text-muted-foreground">נבדקו</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-indigo" />
            {discrepancies.length} אזורים לבדיקה
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Undo/Redo */}
            <div className="flex items-center gap-0.5 border rounded-lg px-1">
              <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} title="בטל (Ctrl+Z)">
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} title="בצע שוב (Ctrl+Y)">
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>

            {highRiskIndices.length > 0 && (
              <Button variant="outline" size="sm" onClick={jumpToNextHighRisk}
                className="gap-1.5 border-rose/30 text-rose hover:bg-rose/10">
                <SkipForward className="h-4 w-4" />חשוד הבא ({highRiskIndices.length})
              </Button>
            )}
            {onExportDocx && (
              <Button variant="outline" size="sm" onClick={() => onExportDocx(discrepancies)}
                className="gap-1.5 border-violet/30 text-violet hover:bg-violet/10">
                <FileDown className="h-4 w-4" />ייצוא DOCX
              </Button>
            )}
            {onSave && (
              <Button
                variant={saveSuccess ? "outline" : "default"} size="sm" onClick={handleSaveAll}
                disabled={isSaving || (!hasUnsavedChanges && !saveSuccess)}
                className={saveSuccess ? "gap-1.5 border-emerald/30 text-emerald" : "gap-1.5 bg-indigo hover:bg-indigo-dark"}>
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" />שומר...</> :
                  saveSuccess ? <><Check className="h-4 w-4" />נשמר</> :
                    <><Save className="h-4 w-4" />שמור{hasUnsavedChanges && <span className="mr-1 h-2 w-2 rounded-full bg-amber" />}</>}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right font-bold w-[12%]">זמן ▶</TableHead>
                <TableHead className="text-right font-bold w-[40%]">טקסט מקורי (עריכה ישירה)</TableHead>
                <TableHead className="text-right font-bold w-[48%]">הערות מבקר + תיקון ידני</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discrepancies.map((item, index) => {
                const risk = riskConfig[item.riskScore || "low"];
                const RiskIcon = risk.icon;
                const isActive = index === activeRowIndex;
                const reasonLabel = RISK_REASON_LABELS[item.riskReason || ""] || item.riskReason || "";

                return (
                  <TableRow
                    key={index} id={`result-row-${index}`}
                    className={`transition-colors duration-300 border-b ${
                      isActive ? "bg-indigo/[0.08] ring-1 ring-inset ring-indigo/20" :
                      item.humanVerified ? "bg-emerald/[0.02]" :
                      item.riskScore === "high" ? "border-r-4 border-r-rose" :
                      item.riskScore === "medium" ? "border-r-4 border-r-amber" : ""
                    }`}>

                    {/* Col 1: Timestamp + Risk */}
                    <TableCell className="align-top py-3">
                      <div className="space-y-1.5">
                        <Button variant="ghost" size="sm"
                          className={`gap-1 font-mono text-sm px-2 py-1 h-auto ${isActive ? "text-indigo font-bold" : "text-indigo hover:text-indigo-dark"}`}
                          onClick={() => onTimestampClick?.(item.timestamp)}>
                          <Play className={`h-3.5 w-3.5 ${isActive ? "animate-pulse" : ""}`} />
                          {item.timestamp}
                        </Button>
                        {item.pageRef && <span className="block text-[10px] text-muted-foreground">{item.pageRef}</span>}
                        <Badge variant="outline" className={`gap-1 text-[10px] ${risk.color}`}>
                          <RiskIcon className="h-2.5 w-2.5" />{risk.label}
                        </Badge>
                        {reasonLabel && <span className="block text-[10px] text-muted-foreground leading-tight">{reasonLabel}</span>}
                      </div>
                    </TableCell>

                    {/* Col 2: Original Text — Heatmap + Editable */}
                    <TableCell className={`align-top py-3 ${!item.humanVerified ? risk.heatBg : ""}`}>
                      <textarea
                        value={item.originalText}
                        onChange={(e) => updateRow(index, { originalText: e.target.value, humanVerified: true })}
                        rows={3}
                        className={`w-full resize-y rounded border px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-indigo/20 ${
                          !item.humanVerified ? `${risk.heatBorder} bg-transparent` : "border-border bg-white"
                        }`}
                        dir="rtl"
                      />
                      {/* Whisper hint — compare mode */}
                      {item.whisperHint && item.whisperHint !== item.originalText && (
                        <details className="mt-1">
                          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                            רמז Whisper (שגיא — לעיון בלבד)
                          </summary>
                          <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground leading-relaxed" dir="rtl">
                            {item.whisperHint}
                          </p>
                        </details>
                      )}
                    </TableCell>

                    {/* Col 3: Notes + Correction + Swap + Verified */}
                    <TableCell className="align-top py-3">
                      <div className="space-y-2">
                        {/* AI explanation */}
                        <div className="rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground leading-relaxed">
                          <span className="font-medium">AI: </span>{item.explanation}
                        </div>

                        {/* Manual correction */}
                        <div>
                          <label className="text-[11px] font-medium text-foreground mb-0.5 block">תיקון ידני:</label>
                          <textarea
                            value={item.correctedText}
                            onChange={(e) => updateRow(index, { correctedText: e.target.value, humanVerified: true })}
                            rows={2}
                            placeholder="הקלידו את הטקסט הנכון..."
                            className="w-full resize-y rounded border border-border bg-white px-2 py-1 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-indigo/20"
                            dir="rtl"
                          />
                        </div>

                        {/* Auditor notes */}
                        <textarea
                          value={item.auditorNotes || ""}
                          onChange={(e) => updateRow(index, { auditorNotes: e.target.value })}
                          rows={1}
                          placeholder="הערה חופשית..."
                          className="w-full resize-y rounded border border-dashed border-border bg-muted/30 px-2 py-1 text-xs leading-relaxed outline-none focus:border-indigo/30 focus:bg-white"
                          dir="rtl"
                        />

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Speaker Swap */}
                          <button onClick={() => swapSpeaker(index)}
                            className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/5 px-2 py-0.5 text-[11px] font-medium text-violet transition-all hover:bg-violet/10"
                            title="החלף דובר (מחזורי)">
                            <ArrowLeftRight className="h-3 w-3" />החלף דובר
                          </button>
                          {/* Verified */}
                          <button onClick={() => updateRow(index, { humanVerified: !item.humanVerified })}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all ${
                              item.humanVerified ? "border-emerald/30 bg-emerald/10 text-emerald" : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                            }`}>
                            <ShieldCheck className="h-3 w-3" />
                            {item.humanVerified ? "נבדק ✓" : "לסימון"}
                          </button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
