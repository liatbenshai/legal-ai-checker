"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  high: { label: "חשד גבוה", color: "text-rose border-rose/40 bg-rose/10", icon: Flame },
  medium: { label: "חשד בינוני", color: "text-amber border-amber/40 bg-amber/10", icon: AlertTriangle },
  low: { label: "חשד נמוך", color: "text-muted-foreground border-border bg-muted/50", icon: Info },
} as const;

const RISK_REASON_LABELS: Record<string, string> = {
  phoneticNonsense: "הזיה פונטית",
  phoneticSimilarity: "דמיון פונטי",
  speakerMismatch: "שיוך דובר חשוד",
  longMonologue: "מונולוג ארוך",
  smoothing: "החלקת עדות",
  semanticGap: "פער סמנטי",
  negationFlip: "היפוך שלילה",
  omission: "השמטה",
  technicalTerm: "מונח מקצועי",
};

function timestampToSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export default function AnalysisResults({
  discrepancies,
  currentAudioTime = 0,
  onTimestampClick,
  onDiscrepanciesChange,
  onSave,
  onExportDocx,
}: AnalysisResultsProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const activeRowIndex = (() => {
    if (currentAudioTime <= 0) return -1;
    for (let i = discrepancies.length - 1; i >= 0; i--) {
      const rowSeconds = timestampToSeconds(discrepancies[i].timestamp);
      if (currentAudioTime >= rowSeconds) return i;
    }
    return -1;
  })();

  const highRiskIndices = useMemo(
    () => discrepancies
      .map((d, i) => (d.riskScore === "high" && !d.humanVerified ? i : -1))
      .filter((i) => i >= 0),
    [discrepancies]
  );

  const jumpToNextHighRisk = useCallback(() => {
    if (highRiskIndices.length === 0) return;
    const currentIdx = activeRowIndex >= 0 ? activeRowIndex : -1;
    const nextIdx = highRiskIndices.find((i) => i > currentIdx) ?? highRiskIndices[0];
    const item = discrepancies[nextIdx];
    onTimestampClick?.(item.timestamp);
    document.getElementById(`result-row-${nextIdx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highRiskIndices, activeRowIndex, discrepancies, onTimestampClick]);

  // Update a single field on a row
  const updateRow = useCallback(
    (index: number, updates: Partial<Discrepancy>) => {
      const updated = discrepancies.map((d, i) =>
        i === index ? { ...d, ...updates } : d
      );
      onDiscrepanciesChange?.(updated);
      setHasUnsavedChanges(true);
    },
    [discrepancies, onDiscrepanciesChange]
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
      document.getElementById(`result-row-${activeRowIndex}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeRowIndex]);

  if (discrepancies.length === 0) {
    return (
      <Card className="border-emerald/30 bg-emerald/5">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="rounded-2xl bg-emerald/10 p-4">
            <FileCheck className="h-10 w-10 text-emerald" />
          </div>
          <div className="text-center">
            <h3 className="text-xl font-bold text-foreground">לא נמצאו אזורים חשודים</h3>
            <p className="mt-2 text-muted-foreground">הפרוטוקול נראה תקין — לא זוהו אנומליות</p>
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
            <div><p className="text-2xl font-bold text-rose">{highCount}</p><p className="text-xs text-muted-foreground">חשד גבוה</p></div>
          </CardContent>
        </Card>
        <Card className="border-amber/20 bg-amber/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber/10 p-2"><AlertCircle className="h-5 w-5 text-amber" /></div>
            <div><p className="text-2xl font-bold text-amber">{medCount}</p><p className="text-xs text-muted-foreground">חשד בינוני</p></div>
          </CardContent>
        </Card>
        <Card className="border-emerald/20 bg-emerald/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-emerald/10 p-2"><Info className="h-5 w-5 text-emerald" /></div>
            <div><p className="text-2xl font-bold text-emerald">{discrepancies.length - highCount - medCount}</p><p className="text-xs text-muted-foreground">חשד נמוך</p></div>
          </CardContent>
        </Card>
        <Card className="border-indigo/20 bg-indigo/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-indigo/10 p-2"><ShieldCheck className="h-5 w-5 text-indigo" /></div>
            <div><p className="text-2xl font-bold text-indigo">{verifiedCount}/{discrepancies.length}</p><p className="text-xs text-muted-foreground">נבדקו</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Auditor Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-indigo" />
            {discrepancies.length} אזורים לבדיקה
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
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
                    <><Save className="h-4 w-4" />שמור התקדמות{hasUnsavedChanges && <span className="mr-1 h-2 w-2 rounded-full bg-amber" />}</>}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right font-bold text-base w-[15%]">זמן ▶</TableHead>
                <TableHead className="text-right font-bold text-base w-[40%]">טקסט מקורי (עריכה ישירה)</TableHead>
                <TableHead className="text-right font-bold text-base w-[45%]">הערות מבקר + תיקון ידני</TableHead>
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
                    key={index}
                    id={`result-row-${index}`}
                    className={`transition-colors duration-300 border-b ${
                      isActive ? "bg-indigo/[0.08] ring-1 ring-inset ring-indigo/20" :
                      item.riskScore === "high" && !item.humanVerified ? "bg-rose/[0.04] border-r-4 border-r-rose" :
                      item.riskScore === "medium" && !item.humanVerified ? "bg-amber/[0.02] border-r-4 border-r-amber" :
                      item.humanVerified ? "bg-emerald/[0.02]" :
                      "hover:bg-muted/50"
                    }`}
                  >
                    {/* Col 1: Timestamp + Play + Risk Badge */}
                    <TableCell className="align-top py-4">
                      <div className="space-y-2">
                        <Button
                          variant="ghost" size="sm"
                          className={`gap-1.5 font-mono text-sm px-2 py-1 h-auto ${isActive ? "text-indigo font-bold" : "text-indigo hover:text-indigo-dark"}`}
                          onClick={() => onTimestampClick?.(item.timestamp)}
                        >
                          <Play className={`h-3.5 w-3.5 ${isActive ? "animate-pulse" : ""}`} />
                          {item.timestamp}
                        </Button>
                        {item.riskScore && item.riskScore !== "low" && (
                          <Badge variant="outline" className={`gap-1 text-[10px] ${risk.color}`}>
                            <RiskIcon className="h-2.5 w-2.5" />{risk.label}
                          </Badge>
                        )}
                        {reasonLabel && (
                          <span className="block text-[10px] text-muted-foreground">{reasonLabel}</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Col 2: Original Text — Editable */}
                    <TableCell className="align-top py-4">
                      <textarea
                        value={item.originalText}
                        onChange={(e) => updateRow(index, { originalText: e.target.value, humanVerified: true })}
                        rows={3}
                        className="w-full resize-y rounded border border-border bg-white px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none focus:border-indigo/30 focus:ring-2 focus:ring-indigo/20"
                        dir="rtl"
                      />
                    </TableCell>

                    {/* Col 3: Auditor Notes + Manual Correction */}
                    <TableCell className="align-top py-4">
                      <div className="space-y-3">
                        {/* AI explanation */}
                        <div className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground leading-relaxed">
                          <span className="font-medium">AI: </span>{item.explanation}
                        </div>

                        {/* Manual correction */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1 block">תיקון ידני:</label>
                          <textarea
                            value={item.correctedText}
                            onChange={(e) => updateRow(index, { correctedText: e.target.value, humanVerified: true })}
                            rows={2}
                            placeholder="הקלידו את הטקסט הנכון לאחר האזנה..."
                            className="w-full resize-y rounded border border-border bg-white px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none focus:border-indigo/30 focus:ring-2 focus:ring-indigo/20"
                            dir="rtl"
                          />
                        </div>

                        {/* Auditor notes */}
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1 block">הערות מבקר:</label>
                          <textarea
                            value={item.auditorNotes || ""}
                            onChange={(e) => updateRow(index, { auditorNotes: e.target.value, humanVerified: true })}
                            rows={1}
                            placeholder="הערה חופשית..."
                            className="w-full resize-y rounded border border-dashed border-border bg-muted/30 px-2 py-1 text-xs leading-relaxed text-foreground outline-none focus:border-indigo/30 focus:bg-white"
                            dir="rtl"
                          />
                        </div>

                        {/* Verified toggle */}
                        <button
                          onClick={() => updateRow(index, { humanVerified: !item.humanVerified })}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all ${
                            item.humanVerified
                              ? "border-emerald/30 bg-emerald/10 text-emerald"
                              : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {item.humanVerified ? "בדיקת אנוש בוצעה ✓" : "לסימון כנבדק"}
                        </button>
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
