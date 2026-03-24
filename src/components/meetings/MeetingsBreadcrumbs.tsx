import React from "react";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface MeetingsBreadcrumbsProps {
  items: BreadcrumbItem[];
}

export const MeetingsBreadcrumbs: React.FC<MeetingsBreadcrumbsProps> = ({
  items,
}) => {
  return (
    <nav className="meetings-breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, idx) => (
        <span key={idx} className="meetings-breadcrumbs__item">
          {idx > 0 && (
            <ChevronRight
              size={14}
              className="meetings-breadcrumbs__separator"
              aria-hidden
            />
          )}
          {item.onClick ? (
            <button
              type="button"
              className="meetings-breadcrumbs__link"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ) : (
            <span className="meetings-breadcrumbs__current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
};
