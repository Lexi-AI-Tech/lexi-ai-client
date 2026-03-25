import React from "react";

type SkeletonVariant =
  | "home"
  | "transcripts"
  | "transcriptsRows"
  | "settings"
  | "vocabulary"
  | "actions"
  | "actionsHistory"
  | "notes"
  | "shortcuts"
  | "docs";

export const ScreenSkeleton: React.FC<{
  variant?: SkeletonVariant;
  className?: string;
}> = ({ variant = "home", className }) => {
  const cls = `skeleton-screen skeleton-screen--${variant} ${
    className ?? ""
  }`.trim();

  const Block = ({
    width = "100%",
    height,
    radius = 10,
    style,
  }: {
    width?: string | number;
    height?: number;
    radius?: number;
    style?: React.CSSProperties;
  }) => (
    <div
      className="skeleton-block"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );

  // These layouts are intentionally simple: “enough structure” to prevent layout
  // jumps and communicate loading state across each screen.
  if (variant === "home") {
    return (
      <div className={cls} style={{ minHeight: "calc(100vh - 190px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Stats cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: 18,
                  borderRadius: 14,
                }}
              >
                <Block width="48px" height={48} radius={14} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  <Block width="65%" height={26} radius={10} />
                  <Block width="45%" height={12} radius={10} />
                  <Block width="70%" height={10} radius={10} />
                </div>
              </div>
            ))}
          </div>

          {/* Two main panels */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>
            {/* Recent Transcriptions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Block width="45%" height={14} radius={8} />
                <Block width="90px" height={28} radius={12} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Block width="100%" height={74} radius={14} />
                  </div>
                ))}
              </div>
            </div>

            {/* Analytics */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Block width="30%" height={14} radius={8} />
                <div style={{ display: "flex", gap: 8 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Block key={i} width={44} height={28} radius={12} />
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Main analytics stat */}
                <div style={{ padding: 18, borderRadius: 14 }}>
                  <Block width="52px" height={52} radius={14} />
                  <div style={{ height: 10 }} />
                  <Block width="60%" height={42} radius={12} />
                  <div style={{ height: 10 }} />
                  <Block width="85%" height={12} radius={10} />
                </div>

                {/* Chart */}
                <div style={{ padding: 10, borderRadius: 14 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 90 }}>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <Block
                        key={i}
                        width="100%"
                        height={10 + (i % 5) * 14}
                        radius={6}
                        style={{ flex: 1 }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {Array.from({ length: 7 }).map((_, i) => (
                      <Block key={i} width="12%" height={10} radius={6} />
                    ))}
                  </div>
                </div>

                {/* Insights */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <Block width="10px" height="10px" radius={999} />
                      <Block width="100%" height={12} radius={10} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "transcripts") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                borderRadius: 14,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* Header row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Block width="52%" height={12} radius={8} />
                <Block width={90} height={14} radius={8} />
              </div>

              {/* Body row: play button + text */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <Block width={28} height={28} radius={999} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  <Block width="95%" height={14} radius={10} />
                  <Block width="88%" height={14} radius={10} />
                </div>
              </div>

              {/* Actions row */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Block width={28} height={28} radius={8} />
                <Block width={28} height={28} radius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "transcriptsRows") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                borderRadius: 14,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Block width="50%" height={12} radius={8} />
                <Block width={84} height={14} radius={8} />
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Block width={28} height={28} radius={999} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  <Block width="92%" height={14} radius={10} />
                  <Block width="82%" height={14} radius={10} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Block width={28} height={28} radius={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "settings") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} width={120} height={38} radius={10} />
            ))}
          </div>
          <Block width="100%" height={160} radius={14} />
          <Block width="100%" height={120} radius={14} />
        </div>
      </div>
    );
  }

  if (variant === "vocabulary") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Block width={120} height={34} radius={12} />
            <Block width={34} height={34} radius={12} />
            <Block width={34} height={34} radius={12} />
            <Block width={34} height={34} radius={12} />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} width="100%" height={62} radius={14} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "actions") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Block width="100%" height={72} radius={14} />
            <Block width="100%" height={72} radius={14} />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} width="100%" height={120} radius={14} />
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <Block width={110} height={34} radius={12} />
            <Block width="80%" height={34} radius={12} />
            <Block width={110} height={34} radius={12} />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "actionsHistory") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Block key={i} width="100%" height={118} radius={14} />
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <Block width={110} height={34} radius={12} />
            <Block width="70%" height={34} radius={12} />
            <Block width={110} height={34} radius={12} />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "notes") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Block width="55%" height={18} radius={10} />
          <Block width="100%" height={48} radius={14} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Block key={i} width="100%" height={88} radius={14} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "shortcuts") {
    return (
      <div className={cls}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Block width={200} height={40} radius={14} />
            <Block width={140} height={40} radius={14} />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} width="100%" height={70} radius={14} />
          ))}
        </div>
      </div>
    );
  }

  // docs (default)
  return (
    <div className={cls}>
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Block key={i} width="100%" height={96} radius={14} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Block width="70%" height={28} radius={12} />
          <Block width="100%" height={44} radius={14} />
          <Block width="100%" height={520} radius={14} />
        </div>
      </div>
    </div>
  );
};

