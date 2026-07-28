import type { ReactNode } from "react";
import CloseButton from "./CloseButton";

interface ToastProps {
  title: string;
  message?: string;
  tone?: "neutral" | "positive" | "critical";
  action?: ReactNode;
  onClose?: () => void;
}
export default function Toast({ title, message, tone = "neutral", action, onClose }: ToastProps) {
  return <div className={`ui-toast ${tone}`} role={tone === "critical" ? "alert" : "status"}><div><strong>{title}</strong>{message && <span>{message}</span>}</div>{action}{onClose && <CloseButton onClick={onClose} label="Dismiss notification" />}</div>;
}
