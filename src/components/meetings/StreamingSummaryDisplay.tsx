/**
 * StreamingSummaryDisplay
 *
 * Renders meeting summary with line-by-line streaming animation.
 * Uses progressive reveal: lines are revealed one-by-one over time for a flowing effect.
 */

import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";

export type SummaryLine = {
  id: string;
  raw: string;
  type: "h2" | "h3" | "bullet" | "paragraph" | "empty";
  content: string;
};

function parseLine(raw: string): SummaryLine["type"] {
  const t = raw.trim();
  if (!t) return "empty";
  if (t.startsWith("## ")) return "h2";
  if (t.startsWith("### ")) return "h3";
  if (t.startsWith("- ") || t.startsWith("* ")) return "bullet";
  return "paragraph";
}

function stripMarkdownPrefix(raw: string, type: SummaryLine["type"]): string {
  switch (type) {
    case "h2":
      return raw.replace(/^##\s+/, "").trim();
    case "h3":
      return raw.replace(/^###\s+/, "").trim();
    case "bullet":
      return raw.replace(/^[-*]\s+/, "").trim();
    default:
      return raw.trim();
  }
}

interface StreamingSummaryDisplayProps {
  lines: SummaryLine[];
  isStreaming?: boolean;
  className?: string;
}

const LINE_ANIMATION = {
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const DELAY_PER_LINE_MS = 85;
const SECTION_BREAK_MS = 180;

export const StreamingSummaryDisplay: React.FC<
  StreamingSummaryDisplayProps
> = ({ lines, isStreaming = false, className = "" }) => {
  const filtered = useMemo(
    () => lines.filter((l) => l.type !== "empty"),
    [lines],
  );

  /** Reveal count: we only render lines with index < visibleCount */
  const [visibleCount, setVisibleCount] = useState(0);

  /** Reset and schedule progressive reveal when lines change */
  useEffect(() => {
    if (filtered.length === 0) {
      setVisibleCount(0);
      return;
    }
    if (isStreaming) {
      setVisibleCount(filtered.length);
      return;
    }
    setVisibleCount(0);
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let t = 0;
    for (let i = 0; i < filtered.length; i++) {
      const line = filtered[i];
      if (line.type === "h2" && i > 0) {
        t += SECTION_BREAK_MS;
      }
      const targetCount = i + 1;
      timeouts.push(
        setTimeout(() => {
          setVisibleCount((prev) => Math.max(prev, targetCount));
        }, t),
      );
      t += DELAY_PER_LINE_MS;
    }
    return () => timeouts.forEach((id) => clearTimeout(id));
  }, [filtered]);

  /** Flatten to items with index for progressive render */
  const flatItems = useMemo(() => {
    const result: { line: SummaryLine; index: number }[] = [];
    filtered.forEach((line, index) => {
      result.push({ line, index });
    });
    return result;
  }, [filtered]);

  /** Group consecutive bullets for valid HTML */
  const blocks = useMemo(() => {
    const result: {
      type: "line" | "list";
      items: { line: SummaryLine; index: number }[];
    }[] = [];
    let i = 0;
    while (i < flatItems.length) {
      const first = flatItems[i];
      if (first.line.type === "bullet") {
        const listItems: { line: SummaryLine; index: number }[] = [];
        while (i < flatItems.length && flatItems[i].line.type === "bullet") {
          listItems.push(flatItems[i]);
          i++;
        }
        result.push({ type: "list", items: listItems });
      } else {
        result.push({ type: "line", items: [first] });
        i++;
      }
    }
    return result;
  }, [flatItems]);

  const renderLine = (line: SummaryLine, index: number) => {
    const isVisible = index < visibleCount;
    switch (line.type) {
      case "h2":
        return (
          <motion.h2
            key={line.id}
            initial={LINE_ANIMATION.initial}
            animate={
              isVisible ? LINE_ANIMATION.animate : LINE_ANIMATION.initial
            }
            className="meetings-summary-stream__h2"
          >
            {line.content}
          </motion.h2>
        );
      case "h3":
        return (
          <motion.h3
            key={line.id}
            initial={LINE_ANIMATION.initial}
            animate={
              isVisible ? LINE_ANIMATION.animate : LINE_ANIMATION.initial
            }
            className="meetings-summary-stream__h3"
          >
            {line.content}
          </motion.h3>
        );
      case "bullet":
        return (
          <motion.li
            key={line.id}
            initial={LINE_ANIMATION.initial}
            animate={
              isVisible ? LINE_ANIMATION.animate : LINE_ANIMATION.initial
            }
            className="meetings-summary-stream__bullet"
          >
            {line.content}
          </motion.li>
        );
      case "paragraph":
      default:
        return (
          <motion.p
            key={line.id}
            initial={LINE_ANIMATION.initial}
            animate={
              isVisible ? LINE_ANIMATION.animate : LINE_ANIMATION.initial
            }
            className="meetings-summary-stream__paragraph"
          >
            {line.content}
          </motion.p>
        );
    }
  };

  return (
    <div className={`meetings-summary-stream ${className}`}>
      {blocks.map((block, blockIdx) => {
        if (block.type === "list") {
          const hasVisible = block.items.some(
            ({ index }) => index < visibleCount,
          );
          if (!hasVisible) return null;
          return (
            <ul
              key={`ul-${block.items[0]?.line.id ?? blockIdx}`}
              className="meetings-summary-stream__ul"
            >
              {block.items
                .filter(({ index }) => index < visibleCount)
                .map(({ line, index }) => renderLine(line, index))}
            </ul>
          );
        }
        return block.items
          .filter(({ index }) => index < visibleCount)
          .map(({ line, index }) => (
            <React.Fragment key={line.id}>
              {renderLine(line, index)}
            </React.Fragment>
          ));
      })}
      {isStreaming && (
        <motion.div
          className="meetings-summary-stream__cursor"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        >
          ▋
        </motion.div>
      )}
    </div>
  );
};

export function createSummaryLine(raw: string, index: number): SummaryLine {
  const type = parseLine(raw);
  const content = stripMarkdownPrefix(raw, type);
  return {
    id: `line-${index}`,
    raw,
    type,
    content,
  };
}
