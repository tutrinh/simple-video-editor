import { useEffect } from "react";
import CloseButton from "../design-system/CloseButton";
import ProductReviewView from "./ProductReviewView";

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied?: (firstBeatId: string | null) => void;
}

export default function ProductReviewDrawer({ open, onClose, onApplied }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <aside className="st-col product-review" role="region" aria-label="Product Review" aria-hidden={!open}>
      <div className="st-product-review-head">
        <h2>Product Review</h2>
        <CloseButton onClick={onClose} label="Close Product Review panel" />
      </div>
      <div className="st-product-review-body no-scrollbar">
        <ProductReviewView onClose={onClose} onApplied={onApplied} />
      </div>
    </aside>
  );
}

