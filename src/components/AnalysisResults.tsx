"use client";

import { useState, useEffect, useCallback } from "react";
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

const significanceConfig = {
  "קריטי": {
    label: "קריטי",
    color: "bg-rose/10 text-rose border-rose/20",
    rowBg: "bg-rose/[0.04] hover:bg-rose/[0.08]",
    dot: "bg-rose",
    icon: AlertTriangle,
  },
  "בינוני": {
    label: "בינוני",
    color: "bg-amber/10 text-amber border-amber/20",
    rowBg: "bg-amber/[0.03] hover:bg-amber/[0.06]",
    dot: "bg-amber",
    icon: AlertCircle,
  },
  "נמוך": {
    label: "נמוך",
    color: "bg-emerald/10 text-emerald border-emerald/20",
    rowBg: "hover:bg-muted/50",
    dot: "bg-emerald",
    icon: Info,
  },
} as const;

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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Find which row the audio is currently at
  const activeRowIndex = (() => {
    if (currentAudioTime <= 0) return -1;
    for (let i = discrepancies.length - 1; i >= 0; i--) {
      const rowSeconds = timestampToSeconds(discrepancies[i].timestamp);
      if (currentAudioTime >= rowSeconds) return i;
    }
    return -1;
  })();

  const startEditing = useCallback((index: number, currentValue: string) => {
    setEditingIndex(index);
    setEditValue(currentValue);
  }, []);

  const commitEdit = useCallback(
    (index: number) => {
      if (editValue !== discrepancies[index].correctedText) {
        const updated = discrepancies.map((d, i) =>
          i === index ? { ...d, correctedText: editValue } : d
        );
        onDiscrepanciesChange?.(updated);
        setHasUnsavedChanges(true);
      }
      setEditingIndex(null);
    },
    [editValue, discrepancies, onDiscrepanciesChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitEdit(index);
      } else if (e.key === "Escape") {
        setEditingIndex(null);
      }
    },
    [commitEdit]
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

  // Auto-scroll to active row
  useEffect(() => {
    if (activeRowIndex >= 0) {
      const row = document.getElementById(`result-row-${activeRowIndex}`);
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
            <h3 className="text-xl font-bold text-foreground">
              לא נמצאו שגיאות מהותיות
            </h3>
            <p className="mt-2 text-muted-foreground">
              הפרוטוקול תואם להקלטה — לא זוהו אי-התאמות שמשנות משמעות
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = discrepancies.filter(
    (d) => d.significance === "קריטי"
  ).length;
  const mediumCount = discrepancies.filter(
    (d) => d.significance === "בינוני"
  ).length;
  const lowCount = discrepancies.filter(
    (d) => d.significance === "נמוך"
  ).length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-rose/20 bg-rose/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-rose/10 p-2">
              <AlertTriangle className="h-5 w-5 text-rose" />
            </div>
            <div>
              <p className="text-2xl font-bold text-rose">{criticalCount}</p>
              <p className="text-sm text-muted-foreground">שגיאות קריטיות</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber/20 bg-amber/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber/10 p-2">
              <AlertCircle className="h-5 w-5 text-amber" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber">{mediumCount}</p>
              <p className="text-sm text-muted-foreground">שגיאות בינוניות</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald/20 bg-emerald/5">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-emerald/10 p-2">
              <Info className="h-5 w-5 text-emerald" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald">{lowCount}</p>
              <p className="text-sm text-muted-foreground">שגיאות קלות</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table — 3 Legal Columns */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-indigo" />
            תוצאות הניתוח — {discrepancies.length} ממצאים
          </CardTitle>
          <div className="flex items-center gap-2">
            {onExportDocx && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportDocx(discrepancies)}
                className="gap-1.5 border-violet/30 text-violet hover:bg-violet/10"
              >
                <FileDown className="h-4 w-4" />
                הפק בקשה רשמית (DOCX)
              </Button>
            )}
            {onSave && (
              <Button
                variant={saveSuccess ? "outline" : "default"}
                size="sm"
                onClick={handleSaveAll}
                disabled={isSaving || (!hasUnsavedChanges && !saveSuccess)}
                className={
                  saveSuccess
                    ? "gap-1.5 border-emerald/30 text-emerald"
                    : "gap-1.5 bg-indigo hover:bg-indigo-dark"
                }
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    שומר...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="h-4 w-4" />
                    נשמר בהצלחה
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    שמור התקדמות
                    {hasUnsavedChanges && (
                      <span className="mr-1 h-2 w-2 rounded-full bg-amber" />
                    )}
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {/* Column 1: Source (PDF) */}
                <TableHead className="text-right font-bold text-base w-[35%]">
                  מקור (PDF)
                </TableHead>
                {/* Column 2: Correction (Audio) */}
                <TableHead className="text-right font-bold text-base w-[35%]">
                  תיקון (מהאודיו)
                </TableHead>
                {/* Column 3: Significance & Explanation */}
                <TableHead className="text-right font-bold text-base w-[30%]">
                  משמעות וסיווג
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discrepancies.map((item, index) => {
                const cfg =
                  significanceConfig[item.significance] ||
                  significanceConfig["נמוך"];
                const IconComponent = cfg.icon;
                const isActive = index === activeRowIndex;
                const isEditing = editingIndex === index;

                return (
                  <TableRow
                    key={index}
                    id={`result-row-${index}`}
                    className={`transition-colors duration-300 border-b ${
                      isActive
                        ? "bg-indigo/[0.08] ring-1 ring-inset ring-indigo/20"
                        : cfg.rowBg
                    }`}
                  >
                    {/* ── Column 1: מקור (PDF) ── */}
                    <TableCell className="align-top py-4">
                      <div className="space-y-2">
                        {/* Timestamp button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`gap-1.5 font-mono text-xs px-2 py-1 h-auto ${
                            isActive
                              ? "text-indigo font-bold"
                              : "text-indigo hover:text-indigo-dark"
                          }`}
                          onClick={() => onTimestampClick?.(item.timestamp)}
                        >
                          <Play
                            className={`h-3 w-3 ${isActive ? "animate-pulse" : ""}`}
                          />
                          {item.timestamp}
                        </Button>
                        {/* PDF text */}
                        <p className="text-sm leading-relaxed text-foreground">
                          {item.originalText}
                        </p>
                      </div>
                    </TableCell>

                    {/* ── Column 2: תיקון (מהאודיו) ── */}
                    <TableCell className="align-top py-4">
                      {isEditing ? (
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(index)}
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          autoFocus
                          rows={3}
                          className="w-full resize-y rounded border border-indigo/30 bg-white px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none ring-2 ring-indigo/20 focus:ring-indigo/40"
                          dir="rtl"
                          placeholder="הקלד תיקון..."
                        />
                      ) : (
                        <p
                          className="cursor-pointer text-sm leading-relaxed text-foreground rounded px-1 py-0.5 transition-colors hover:bg-indigo/5"
                          onClick={() =>
                            startEditing(index, item.correctedText)
                          }
                          title="לחץ לעריכה"
                        >
                          {item.correctedText}
                        </p>
                      )}
                    </TableCell>

                    {/* ── Column 3: משמעות וסיווג ── */}
                    <TableCell className="align-top py-4">
                      <div className="space-y-2">
                        <Badge
                          variant="outline"
                          className={`gap-1.5 text-sm px-2.5 py-1 ${cfg.color}`}
                        >
                          <IconComponent className="h-3.5 w-3.5" />
                          {cfg.label}
                        </Badge>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {item.explanation}
                        </p>
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
