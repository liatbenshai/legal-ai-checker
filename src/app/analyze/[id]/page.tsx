"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Scale, ShieldCheck, Home, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import AnalysisResults from "@/components/AnalysisResults";
import type { Discrepancy } from "@/lib/types";

export default function EditAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/transcripts/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "שגיאה בטעינה");
        setDiscrepancies(data.discrepancies);
        setFileName(data.fileName);
      } catch (err) {
        setError(err instanceof Error ? err.message : "שגיאה בטעינה");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handleExportDocx = useCallback(
    async (exportDiscrepancies: Discrepancy[]) => {
      const { generateLegalDocx } = await import("@/lib/export-legal");
      const { Packer } = await import("docx");
      const { saveAs } = await import("file-saver");
      const doc = generateLegalDocx({
        fileName,
        discrepancies: exportDiscrepancies,
      });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `בקשה-לתיקון-פרוטוקול-${new Date().toISOString().slice(0, 10)}.docx`);
    },
    [fileName]
  );

  const handleSave = useCallback(
    async (updatedDiscrepancies: Discrepancy[]) => {
      const res = await fetch("/api/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptId: id,
          fileName,
          discrepancies: updatedDiscrepancies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    },
    [id, fileName]
  );

  return (
    <div className="min-h-screen bg-gradient-to-bl from-slate-50 via-indigo-50/30 to-violet-50/20">
      {/* Header */}
      <header className="border-b border-border/50 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo text-white shadow-md shadow-indigo/25">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">עריכת ניתוח</h1>
              <p className="text-xs text-muted-foreground">
                {fileName || "טוען..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Home className="h-4 w-4" />
                לוח בקרה
              </Button>
            </Link>
            <div className="flex items-center gap-2 rounded-full bg-emerald/10 px-3 py-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald" />
              <span className="text-xs font-medium text-emerald-dark">מאובטח</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {loading && (
          <div className="flex flex-col items-center gap-4 py-24">
            <Loader2 className="h-10 w-10 animate-spin text-indigo" />
            <p className="text-muted-foreground">טוען נתוני ניתוח...</p>
          </div>
        )}

        {error && (
          <Card className="mx-auto max-w-2xl border-rose/30 bg-rose/5">
            <CardContent className="flex items-center gap-3 p-6">
              <XCircle className="h-6 w-6 shrink-0 text-rose" />
              <div>
                <p className="font-semibold text-rose">שגיאה</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {discrepancies && (
          <AnalysisResults
            discrepancies={discrepancies}
            onDiscrepanciesChange={setDiscrepancies}
            onSave={handleSave}
            onExportDocx={handleExportDocx}
          />
        )}
      </main>
    </div>
  );
}
