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
import type { Discrepancy } from "@/lib/types";

interface Props {
  discrepancies: Discrepancy[];
  currentAudioTime?: number;
  onTimestampClick?: (timestamp: string) => void;
  onDiscrepanciesChange?: (d: Discrepancy[]) => void;
  onSave?: (d: Discrepancy[]) => Promise<void>;
  onExportDocx?: (d: Discrepancy[]) => void;
}

const riskCfg = {
  high: { label: "קריטי", color: "text-rose border-rose/40 bg-rose/10", icon: Flame, heat: "bg-rose/[0.07]" },
  medium: { label: "אזהרה", color: "text-amber border-amber/40 bg-amber/10", icon: AlertTriangle, heat: "bg-amber/[0.05]" },
  low: { label: "נמוך", color: "text-muted-foreground border-border bg-muted/30", icon: Info, heat: "" },
} as const;

const REASON_LABELS: Record<string, string> = {
  speakerFatigue: "בלוק ארוך — חשד להחלפת דובר",
  negationFlag: "⚠ שלילה/אישור — בדיקה חובה",
  entityWatch: "שם/מספר — אימות ידני",
  morphologicalRisk: "סיומת מורפולוגית חשודה",
  legalHallucination: "מילה לא במקומה",
  gibberish: "מילה לא קיימת",
  syntaxCollapse: "קריסת תחביר",
  smoothing: "החלקת עדות",
  semanticGap: "פער סמנטי",
  speakerOverlap: "שיוך דובר חשוד",
  stylistic: "סגנון חריג",
};

function tsToSec(ts: string) { const p = ts.split(":").map(Number); return (p[0]||0)*60+(p[1]||0); }

// ── Undo/Redo ──
function useHistory<T>(initial: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState(initial);
  const [future, setFuture] = useState<T[]>([]);
  const init = useRef(false);
  useEffect(() => { if (!init.current) { setPresent(initial); init.current = true; } }, [initial]);
  const push = useCallback((s: T) => { setPast(p => [...p.slice(-30), present]); setPresent(s); setFuture([]); }, [present]);
  const undo = useCallback(() => { if (!past.length) return; setFuture(f => [present, ...f]); setPresent(past[past.length-1]); setPast(p => p.slice(0,-1)); }, [past, present]);
  const redo = useCallback(() => { if (!future.length) return; setPast(p => [...p, present]); setPresent(future[0]); setFuture(f => f.slice(1)); }, [future, present]);
  return { state: present, push, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export default function AnalysisResults({
  discrepancies: ext,
  currentAudioTime = 0,
  onTimestampClick,
  onDiscrepanciesChange,
  onSave,
  onExportDocx,
}: Props) {
  const { state: rows, push, undo, redo, canUndo, canRedo } = useHistory(ext);
  const [isSaving, setIsSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [focusedRow, setFocusedRow] = useState(0);

  useEffect(() => { if (rows !== ext) onDiscrepanciesChange?.(rows); }, [rows, ext, onDiscrepanciesChange]);

  // Keyboard: Ctrl+Z, Ctrl+Y, Ctrl+Enter
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        // Verified & Next
        if (focusedRow < rows.length) {
          updateRow(focusedRow, { humanVerified: true });
          const next = focusedRow + 1 < rows.length ? focusedRow + 1 : focusedRow;
          setFocusedRow(next);
          document.getElementById(`row-${next}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [undo, redo, focusedRow, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRow = (() => {
    if (currentAudioTime <= 0) return -1;
    for (let i = rows.length - 1; i >= 0; i--) { if (currentAudioTime >= tsToSec(rows[i].timestamp)) return i; }
    return -1;
  })();

  const highIdx = useMemo(() => rows.map((d,i) => d.riskScore === "high" && !d.humanVerified ? i : -1).filter(i => i >= 0), [rows]);

  const jumpNext = useCallback(() => {
    if (!highIdx.length) return;
    const cur = focusedRow;
    const next = highIdx.find(i => i > cur) ?? highIdx[0];
    setFocusedRow(next);
    onTimestampClick?.(rows[next].timestamp);
    document.getElementById(`row-${next}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highIdx, focusedRow, rows, onTimestampClick]);

  const updateRow = useCallback((i: number, u: Partial<Discrepancy>) => {
    push(rows.map((d, idx) => idx === i ? { ...d, ...u } : d));
    setDirty(true);
  }, [rows, push]);

  const swapSpeaker = useCallback((i: number) => {
    const text = rows[i].originalText;
    const pat = /^(השופט|עו"ד|העד|הנאשם|התובע|ב"כ התביעה|ב"כ ההגנה)(\s*:?\s*)/;
    const m = text.match(pat);
    const speakers = ["השופט","עו\"ד","העד","הנאשם","התובע"];
    if (m) {
      const ci = speakers.indexOf(m[1]);
      const ns = speakers[(ci+1)%speakers.length];
      updateRow(i, { correctedText: text.replace(pat, `${ns}${m[2]}`), humanVerified: true, auditorNotes: `החלפת דובר: ${m[1]} → ${ns}` });
    } else {
      updateRow(i, { auditorNotes: (rows[i].auditorNotes||"") + " [החלפת דובר נדרשת]" });
    }
  }, [rows, updateRow]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true); setSaveOk(false);
    try { await onSave(rows); setSaveOk(true); setDirty(false); setTimeout(() => setSaveOk(false), 3000); }
    catch (e) { console.error("Save failed:", e); }
    finally { setIsSaving(false); }
  }, [onSave, rows]);

  useEffect(() => {
    if (activeRow >= 0) document.getElementById(`row-${activeRow}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeRow]);

  if (!rows.length) {
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

  const hc = rows.filter(d => d.riskScore === "high").length;
  const mc = rows.filter(d => d.riskScore === "medium").length;
  const vc = rows.filter(d => d.humanVerified).length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-rose/20 bg-rose/5"><CardContent className="flex items-center gap-3 p-3">
          <div className="rounded-lg bg-rose/10 p-2"><Flame className="h-5 w-5 text-rose" /></div>
          <div><p className="text-2xl font-bold text-rose">{hc}</p><p className="text-[11px] text-muted-foreground">קריטי</p></div>
        </CardContent></Card>
        <Card className="border-amber/20 bg-amber/5"><CardContent className="flex items-center gap-3 p-3">
          <div className="rounded-lg bg-amber/10 p-2"><AlertCircle className="h-5 w-5 text-amber" /></div>
          <div><p className="text-2xl font-bold text-amber">{mc}</p><p className="text-[11px] text-muted-foreground">אזהרה</p></div>
        </CardContent></Card>
        <Card className="border-emerald/20 bg-emerald/5"><CardContent className="flex items-center gap-3 p-3">
          <div className="rounded-lg bg-emerald/10 p-2"><Info className="h-5 w-5 text-emerald" /></div>
          <div><p className="text-2xl font-bold text-emerald">{rows.length-hc-mc}</p><p className="text-[11px] text-muted-foreground">נמוך</p></div>
        </CardContent></Card>
        <Card className="border-indigo/20 bg-indigo/5"><CardContent className="flex items-center gap-3 p-3">
          <div className="rounded-lg bg-indigo/10 p-2"><ShieldCheck className="h-5 w-5 text-indigo" /></div>
          <div><p className="text-2xl font-bold text-indigo">{vc}/{rows.length}</p><p className="text-[11px] text-muted-foreground">נבדקו</p></div>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">{rows.length} אזורים</span>
          <div className="flex items-center gap-0.5 border rounded-lg px-0.5">
            <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} title="בטל (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} title="שחזר (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
          </div>
          <span className="text-[10px] text-muted-foreground">Ctrl+Enter = אימות והבא</span>
        </div>
        <div className="flex items-center gap-2">
          {highIdx.length > 0 && (
            <Button variant="outline" size="sm" onClick={jumpNext} className="gap-1.5 border-rose/30 text-rose hover:bg-rose/10">
              <SkipForward className="h-3.5 w-3.5" />חשוד הבא ({highIdx.length})
            </Button>
          )}
          {onExportDocx && (
            <Button variant="outline" size="sm" onClick={() => onExportDocx(rows)} className="gap-1.5 border-violet/30 text-violet hover:bg-violet/10">
              <FileDown className="h-3.5 w-3.5" />DOCX
            </Button>
          )}
          {onSave && (
            <Button variant={saveOk ? "outline" : "default"} size="sm" onClick={handleSave}
              disabled={isSaving || (!dirty && !saveOk)}
              className={saveOk ? "gap-1.5 border-emerald/30 text-emerald" : "gap-1.5 bg-indigo hover:bg-indigo-dark"}>
              {isSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />שומר...</>
                : saveOk ? <><Check className="h-3.5 w-3.5" />נשמר</>
                : <><Save className="h-3.5 w-3.5" />שמור{dirty && <span className="mr-1 h-2 w-2 rounded-full bg-amber" />}</>}
            </Button>
          )}
        </div>
      </div>

      {/* 4-Column Judge's Workbench */}
      <div className="rounded-lg border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[80px_1fr_1fr_90px] bg-muted/60 border-b text-sm font-bold text-foreground">
          <div className="p-2 text-center">סנכרון</div>
          <div className="p-2 border-r">טקסט מקורי (PDF)</div>
          <div className="p-2 border-r">הערת תיקון לבית המשפט</div>
          <div className="p-2 text-center">סטטוס</div>
        </div>

        {/* Rows */}
        {rows.map((item, i) => {
          const risk = riskCfg[item.riskScore || "low"];
          const RiskIcon = risk.icon;
          const isActive = i === activeRow;
          const isFocused = i === focusedRow;
          const reasonLabel = REASON_LABELS[item.riskReason || ""] || item.riskReason || "";

          return (
            <div
              key={i}
              id={`row-${i}`}
              onClick={() => setFocusedRow(i)}
              className={`grid grid-cols-[80px_1fr_1fr_90px] border-b transition-all duration-200 ${
                isActive ? "ring-2 ring-inset ring-indigo/30 bg-indigo/[0.06]" :
                item.humanVerified ? "bg-emerald/[0.03]" :
                item.riskScore === "high" ? "border-r-4 border-r-rose" :
                item.riskScore === "medium" ? "border-r-4 border-r-amber" : ""
              } ${isFocused ? "outline outline-2 outline-indigo/20" : ""}`}
            >
              {/* Col 1: Sync */}
              <div className="p-2 flex flex-col items-center gap-1.5 border-l">
                <Button variant="ghost" size="sm"
                  className={`gap-1 font-mono text-xs px-1.5 py-0.5 h-auto ${isActive ? "text-indigo font-bold" : "text-indigo hover:text-indigo-dark"}`}
                  onClick={(e) => { e.stopPropagation(); onTimestampClick?.(item.timestamp); }}>
                  <Play className={`h-3 w-3 ${isActive ? "animate-pulse" : ""}`} />
                  {item.timestamp}
                </Button>
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${risk.color}`}>
                  <RiskIcon className="h-2.5 w-2.5 mr-0.5" />{risk.label}
                </Badge>
                {reasonLabel && <span className="text-[9px] text-muted-foreground text-center leading-tight">{reasonLabel}</span>}
                {item.pageRef && <span className="text-[9px] text-muted-foreground">{item.pageRef}</span>}
              </div>

              {/* Col 2: Original PDF Text — Editable + Heatmap */}
              <div className={`p-2 border-r ${!item.humanVerified ? risk.heat : ""}`}>
                <textarea
                  value={item.originalText}
                  onChange={(e) => updateRow(i, { originalText: e.target.value, humanVerified: true })}
                  rows={3}
                  className={`w-full resize-y rounded border px-2 py-1 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-indigo/20 ${
                    !item.humanVerified && item.riskScore === "high" ? "border-rose/30 bg-rose/[0.04]" :
                    !item.humanVerified && item.riskScore === "medium" ? "border-amber/30 bg-amber/[0.03]" :
                    "border-border bg-white"
                  }`}
                  dir="rtl"
                />
                {/* Speaker Swap */}
                <button onClick={() => swapSpeaker(i)}
                  className="mt-1 inline-flex items-center gap-1 rounded border border-violet/20 bg-violet/5 px-1.5 py-0.5 text-[10px] text-violet hover:bg-violet/10">
                  <ArrowLeftRight className="h-2.5 w-2.5" />החלף דובר
                </button>
              </div>

              {/* Col 3: Correction Note */}
              <div className="p-2 border-r space-y-1.5">
                <div className="rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground leading-relaxed">
                  <span className="font-medium">AI: </span>{item.explanation}
                </div>
                <textarea
                  value={item.correctedText}
                  onChange={(e) => updateRow(i, { correctedText: e.target.value, humanVerified: true })}
                  rows={2}
                  placeholder="תיקון רשמי לבית המשפט..."
                  className="w-full resize-y rounded border border-border bg-white px-2 py-1 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-indigo/20"
                  dir="rtl"
                />
                <textarea
                  value={item.auditorNotes || ""}
                  onChange={(e) => updateRow(i, { auditorNotes: e.target.value })}
                  rows={1}
                  placeholder="הערה פנימית..."
                  className="w-full resize-y rounded border border-dashed border-border bg-muted/20 px-2 py-0.5 text-[11px] outline-none focus:bg-white"
                  dir="rtl"
                />
              </div>

              {/* Col 4: Status — Verified toggle */}
              <div className="p-2 flex flex-col items-center justify-center gap-1.5">
                <button
                  onClick={() => {
                    updateRow(i, { humanVerified: !item.humanVerified });
                    if (!item.humanVerified && i + 1 < rows.length) {
                      setFocusedRow(i + 1);
                      document.getElementById(`row-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                    item.humanVerified
                      ? "border-emerald/30 bg-emerald/10 text-emerald"
                      : "border-border bg-white text-muted-foreground hover:bg-muted"
                  }`}>
                  <ShieldCheck className="h-3.5 w-3.5 mx-auto mb-0.5" />
                  {item.humanVerified ? "בוצע ✓" : "בדיקה"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
