"use client";

import { useCallback, useState } from "react";
import { Upload, FileAudio, FileText, X, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface FileUploadZoneProps {
  type: "audio" | "pdf";
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
  selectedFile: File | null;
}

const config = {
  audio: {
    accept: ".mp3,.wav,.m4a",
    acceptTypes: ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/mp4"],
    label: "העלאת קובץ אודיו",
    description: "גרור לכאן קובץ MP3, WAV או M4A",
    icon: FileAudio,
    accentColor: "indigo",
  },
  pdf: {
    accept: ".pdf",
    acceptTypes: ["application/pdf"],
    label: "העלאת קובץ PDF",
    description: "גרור לכאן קובץ PDF של התמלול",
    icon: FileText,
    accentColor: "violet",
  },
};

export default function FileUploadZone({
  type,
  onFileSelect,
  onFileRemove,
  selectedFile,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { accept, acceptTypes, label, description, icon: Icon, accentColor } =
    config[type];

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file && acceptTypes.some((t) => file.type === t)) {
        onFileSelect(file);
      }
    },
    [acceptTypes, onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (selectedFile) {
    return (
      <Card className={`border-2 border-${accentColor}/30 bg-${accentColor}/5`}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg bg-${accentColor}/10 p-2`}>
                <CheckCircle2 className="h-6 w-6 text-emerald" />
              </div>
              <div>
                <p className="font-medium text-foreground">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            <button
              onClick={onFileRemove}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="הסר קובץ"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`border-2 border-dashed transition-all duration-200 ${
        isDragging
          ? `border-${accentColor} bg-${accentColor}/5 scale-[1.02]`
          : "border-border hover:border-primary/40 hover:bg-muted/50"
      }`}
    >
      <CardContent className="p-0">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-4 p-10"
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div
            className={`rounded-2xl p-4 transition-colors ${
              isDragging ? `bg-${accentColor}/15` : "bg-muted"
            }`}
          >
            {isDragging ? (
              <Upload className={`h-10 w-10 text-${accentColor}`} />
            ) : (
              <Icon className={`h-10 w-10 text-${accentColor}`} />
            )}
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-3 text-sm font-medium text-primary">
              לחץ לבחירת קובץ
            </p>
          </div>
          <input
            type="file"
            accept={accept}
            onChange={handleFileInput}
            className="hidden"
          />
        </label>
      </CardContent>
    </Card>
  );
}
