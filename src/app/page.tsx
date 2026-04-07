"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Scale,
  ShieldCheck,
  Plus,
  BookOpen,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pencil,
  FileDown,
  Loader2,
  BarChart3,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TranscriptSummary {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  discrepancyCount: number;
  criticalCount: number;
}

const statusConfig: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2; animate?: boolean }
> = {
  done: {
    label: "הושלם",
    color: "bg-emerald/10 text-emerald border-emerald/20",
    icon: CheckCircle2,
  },
  processing: {
    label: "בניתוח...",
    color: "bg-indigo/10 text-indigo border-indigo/20",
    icon: Loader2,
    animate: true,
  },
  pending: {
    label: "ממתין",
    color: "bg-amber/10 text-amber border-amber/20",
    icon: Clock,
  },
  error: {
    label: "שגיאה",
    color: "bg-rose/10 text-rose border-rose/20",
    icon: AlertTriangle,
  },
};

export default function DashboardPage() {
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchTranscripts = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/transcripts", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setTranscripts(data.transcripts || []);
        setLastRefresh(new Date());
      }
    } catch {
      // silently fail — dashboard still usable
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchTranscripts(true);
  }, [fetchTranscripts]);

  // Auto-refresh every 15 seconds if any transcript is processing
  useEffect(() => {
    const hasProcessing = transcripts.some(
      (t) => t.status === "processing" || t.status === "pending"
    );
    if (!hasProcessing) return;

    const interval = setInterval(() => fetchTranscripts(false), 15000);
    return () => clearInterval(interval);
  }, [transcripts, fetchTranscripts]);

  const completedCount = transcripts.filter((t) => t.status === "done").length;
  const openCount = transcripts.filter((t) => t.status !== "done").length;
  const totalCritical = transcripts.reduce((s, t) => s + t.criticalCount, 0);

  const handleExportDocx = async (id: string) => {
    try {
      const res = await fetch(`/api/transcripts/${id}`);
      const data = await res.json();
      if (!res.ok) return;

      const { generateLegalDocx } = await import("@/lib/export-legal");
      const { Packer } = await import("docx");
      const { saveAs } = await import("file-saver");
      const doc = generateLegalDocx({
        fileName: data.fileName,
        discrepancies: data.discrepancies,
      });
      const blob = await Packer.toBlob(doc);
      saveAs(
        blob,
        `בקשה-לתיקון-${data.fileName}-${new Date().toISOString().slice(0, 10)}.docx`
      );
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

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
              <h1 className="text-lg font-bold text-foreground">
                זיהוי שגיאות AI
              </h1>
              <p className="text-xs text-muted-foreground">לוח בקרה</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/analyze">
              <Button
                size="sm"
                className="gap-1.5 bg-indigo hover:bg-indigo-dark"
              >
                <Plus className="h-4 w-4" />
                ניתוח חדש
              </Button>
            </Link>
            <div className="flex items-center gap-2 rounded-full bg-emerald/10 px-3 py-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald" />
              <span className="text-xs font-medium text-emerald-dark">
                מאובטח
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-indigo/20 bg-gradient-to-bl from-white to-indigo-50/30">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-indigo/10 p-3">
                <BarChart3 className="h-6 w-6 text-indigo" />
              </div>
              <div>
                <p className="text-3xl font-bold text-indigo">
                  {completedCount}
                </p>
                <p className="text-sm text-muted-foreground">ניתוחים שהושלמו</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber/20 bg-gradient-to-bl from-white to-amber-50/30">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-amber/10 p-3">
                <FolderOpen className="h-6 w-6 text-amber" />
              </div>
              <div>
                <p className="text-3xl font-bold text-amber">{openCount}</p>
                <p className="text-sm text-muted-foreground">תיקים פתוחים</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-rose/20 bg-gradient-to-bl from-white to-rose-50/30">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-xl bg-rose/10 p-3">
                <AlertTriangle className="h-6 w-6 text-rose" />
              </div>
              <div>
                <p className="text-3xl font-bold text-rose">{totalCritical}</p>
                <p className="text-sm text-muted-foreground">
                  שגיאות קריטיות (סה&quot;כ)
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Cards */}
        <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Link href="/analyze" className="block">
            <Card className="group cursor-pointer border-2 border-indigo/20 bg-gradient-to-bl from-white to-indigo-50/40 transition-all hover:border-indigo/40 hover:shadow-lg hover:shadow-indigo/10">
              <CardContent className="flex items-center gap-5 p-8">
                <div className="rounded-2xl bg-indigo/10 p-4 transition-transform group-hover:scale-110">
                  <Plus className="h-8 w-8 text-indigo" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    ניתוח חדש
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    העלאת אודיו ו-PDF להשוואה אוטומטית
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Card className="border-2 border-violet/20 bg-gradient-to-bl from-white to-violet-50/40">
            <CardContent className="flex items-center gap-5 p-8">
              <div className="rounded-2xl bg-violet/10 p-4">
                <BookOpen className="h-8 w-8 text-violet" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">
                  המדריך למתמלל
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  שימו לב להשמטות של &quot;לא&quot;, בלבולי הומופונים, ושינויי
                  שמות — אלו השגיאות הנפוצות ביותר במערכות AI.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* History Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo" />
              היסטוריית ניתוחים
            </CardTitle>
            <div className="flex items-center gap-3">
              {lastRefresh && (
                <span className="text-xs text-muted-foreground">
                  עודכן {lastRefresh.toLocaleTimeString("he-IL")}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchTranscripts(true)}
                disabled={loading}
                className="gap-1.5"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                רענן
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-16">
                <Loader2 className="h-6 w-6 animate-spin text-indigo" />
                <p className="text-muted-foreground">טוען נתונים...</p>
              </div>
            ) : transcripts.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-16">
                <div className="rounded-2xl bg-muted p-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground">
                    אין ניתוחים עדיין
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    התחילו ניתוח חדש כדי לראות תוצאות כאן
                  </p>
                </div>
                <Link href="/analyze">
                  <Button className="mt-2 gap-1.5 bg-indigo hover:bg-indigo-dark">
                    <Plus className="h-4 w-4" />
                    ניתוח חדש
                  </Button>
                </Link>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-right font-bold">
                      שם הקובץ
                    </TableHead>
                    <TableHead className="w-[140px] text-right font-bold">
                      תאריך
                    </TableHead>
                    <TableHead className="w-[100px] text-right font-bold">
                      שגיאות
                    </TableHead>
                    <TableHead className="w-[100px] text-right font-bold">
                      סטטוס
                    </TableHead>
                    <TableHead className="w-[180px] text-right font-bold">
                      פעולות
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transcripts.map((t) => {
                    const sc = statusConfig[t.status] || statusConfig.pending;
                    const StatusIcon = sc.icon;

                    return (
                      <TableRow key={t.id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">
                          {t.fileName}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(t.createdAt).toLocaleDateString("he-IL", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {t.discrepancyCount}
                            </span>
                            {t.criticalCount > 0 && (
                              <Badge
                                variant="outline"
                                className="border-rose/20 bg-rose/10 text-rose text-xs"
                              >
                                {t.criticalCount} קריטי
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`gap-1 ${sc.color}`}
                          >
                            <StatusIcon
                              className={`h-3 w-3 ${sc.animate ? "animate-spin" : ""}`}
                            />
                            {sc.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Link href={`/analyze/${t.id}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-indigo hover:text-indigo-dark"
                                title="עריכה"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                עריכה
                              </Button>
                            </Link>
                            {t.status === "done" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-violet hover:text-violet-light"
                                title="הורדת בקשה רשמית"
                                onClick={() => handleExportDocx(t.id)}
                              >
                                <FileDown className="h-3.5 w-3.5" />
                                DOCX
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t border-border/50 bg-white/50 py-6 text-center text-sm text-muted-foreground">
        <p>
          מערכת זיהוי שגיאות בתמלול משפטי &copy; {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
