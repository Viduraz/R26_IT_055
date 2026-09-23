import { useEffect, useState } from "react";
import { getDayReport, getWeekReport } from "../services/scheduleApi";

const todayStr = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export default function Reports() {
  const [reportMode, setReportMode] = useState("day");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [dayReport, setDayReport] = useState(null);
  const [weekReport, setWeekReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState(null);

  useEffect(() => {
    fetchReport();
  }, [reportMode, selectedDate]);

  const fetchReport = async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      if (reportMode === "day") {
        const res = await getDayReport(selectedDate);
        setDayReport(res.data || null);
        setWeekReport(null);
      } else {
        const res = await getWeekReport(selectedDate);
        setWeekReport(res.data || null);
        setDayReport(null);
      }
    } catch (error) {
      console.error("Error fetching report:", error);
      setReportError("Couldn't load that report. Try a different date.");
    } finally {
      setReportLoading(false);
    }
  };

  const renderCounts = (counts) => {
    if (!counts) return null;

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">Done</p>
          <p className="text-3xl font-bold text-emerald-400">{counts.done ?? 0}</p>
        </div>
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">Late</p>
          <p className="text-3xl font-bold text-amber-400">{counts.late ?? 0}</p>
        </div>
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">Missed</p>
          <p className="text-3xl font-bold text-rose-400">{counts.missed ?? 0}</p>
        </div>
        <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">Total</p>
          <p className="text-3xl font-bold text-white">{counts.total ?? 0}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full pb-20 animate-slide-up">
      <div className="rounded-3xl border border-gray-800 bg-gray-900/40 backdrop-blur-md p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-[10px] font-bold uppercase tracking-[0.25em] text-purple-300">
              Daily Reports
            </div>
            <h1 className="mt-4 text-3xl md:text-4xl font-extrabold text-white">Reports</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-gray-800 overflow-hidden">
              <button
                onClick={() => setReportMode("day")}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  reportMode === "day"
                    ? "bg-purple-500/20 text-purple-300"
                    : "bg-gray-950/40 text-gray-400 hover:text-gray-200"
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setReportMode("week")}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${
                  reportMode === "week"
                    ? "bg-purple-500/20 text-purple-300"
                    : "bg-gray-950/40 text-gray-400 hover:text-gray-200"
                }`}
              >
                Week
              </button>
            </div>

            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-gray-950/40 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </div>

        {reportLoading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
          </div>
        ) : reportError ? (
          <div className="py-16 text-center text-rose-400 text-sm">{reportError}</div>
        ) : reportMode === "day" ? (
          <div>
            {dayReport ? (
              <>
                {renderCounts(dayReport.counts)}
                <div className="rounded-2xl border border-gray-800 bg-gray-950/30 p-4">
                  <h2 className="text-lg font-semibold text-white mb-4">Saved Activities</h2>
                  {dayReport.activities?.length ? (
                    <div className="space-y-3">
                      {dayReport.activities.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between border-b border-gray-800 pb-3 last:border-b-0 last:pb-0">
                          <div>
                            <p className="font-medium text-gray-200">{item.activity_name || "Unnamed activity"}</p>
                            <p className="text-xs text-gray-500 font-mono">{item.detected_at || "N/A"}</p>
                          </div>
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                            item.status === "done"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : item.status === "late"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : item.status === "missed"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-gray-800 text-gray-300 border-gray-700"
                          }`}>
                            {item.status || "pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No activities were saved for this date.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-gray-500 text-sm">
                No archived report found for {selectedDate}.
              </div>
            )}
          </div>
        ) : (
          <div>
            {weekReport ? (
              <>
                {renderCounts(weekReport.weekly_totals)}
                <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/30">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.2em] text-gray-500 bg-gray-950/50">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold text-center">Done</th>
                        <th className="px-4 py-3 font-semibold text-center">Late</th>
                        <th className="px-4 py-3 font-semibold text-center">Missed</th>
                        <th className="px-4 py-3 font-semibold text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(weekReport.daily_reports || []).map((day, idx) => (
                        <tr key={idx} className="border-t border-gray-800">
                          <td className="px-4 py-3 text-sm text-gray-200 font-mono">{day.date}</td>
                          {day.counts ? (
                            <>
                              <td className="px-4 py-3 text-center text-emerald-400 font-semibold">{day.counts.done ?? 0}</td>
                              <td className="px-4 py-3 text-center text-amber-400 font-semibold">{day.counts.late ?? 0}</td>
                              <td className="px-4 py-3 text-center text-rose-400 font-semibold">{day.counts.missed ?? 0}</td>
                              <td className="px-4 py-3 text-center text-white font-semibold">{day.counts.total ?? 0}</td>
                            </>
                          ) : (
                            <td colSpan="4" className="px-4 py-3 text-center text-gray-500 text-sm">
                              No report saved
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-gray-500 text-sm">
                No weekly archive found for the selected period.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}