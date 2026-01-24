import { invoke } from "@tauri-apps/api/core";

export interface AnalyticsStats {
    words_typed_this_week: number;
    time_saved_minutes: number;
    current_streak: number;
}

export interface ChartData {
    labels: string[];
    data: number[];
    total_transcriptions: number;
}

export type AnalyticsPeriod = "1d" | "7d" | "30d";

/**
 * Fetch user analytics statistics
 */
export async function getAnalyticsStats(): Promise<AnalyticsStats> {
    try {
        return await invoke<AnalyticsStats>("get_analytics_stats");
    } catch (error) {
        console.error("Failed to fetch analytics stats:", error);
        throw error;
    }
}

/**
 * Fetch chart data for a specific period
 */
export async function getAnalyticsChart(
    period: AnalyticsPeriod
): Promise<ChartData> {
    try {
        return await invoke<ChartData>("get_analytics_chart", { period });
    } catch (error) {
        console.error(`Failed to fetch analytics chart for period ${period}:`, error);
        throw error;
    }
}
