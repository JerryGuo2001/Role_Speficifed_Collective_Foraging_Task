/* ===========================
   data_save.js
   - Centralized logger + CSV export
   - CSV headers = UNION of keys across all rows (no missing columns)
   =========================== */

(function () {
  "use strict";

  class DataSaver {
    constructor() {
      this.participantId = null;
      this.rows = [];
      this.sessionStartPerf = 0;
      this.lastEventPerf = 0;
    }

    init(participantId) {
      if (!participantId) throw new Error("DataSaver.init requires participantId");
      this.participantId = participantId;
      this.rows = [];
      this.sessionStartPerf = performance.now();
      this.lastEventPerf = this.sessionStartPerf;
    }

    log(evt) {
      const nowPerf = performance.now();
      const rt = Math.round(nowPerf - this.lastEventPerf);
      this.lastEventPerf = nowPerf;

      this.rows.push({
        participant_id: this.participantId,
        iso_time: new Date().toISOString(),
        rt_ms: rt,
        ...evt,
      });
    }

    // Preferred header order for readability (everything else appended alphabetically)
    _preferredHeaders(allKeys) {
      const preferred = [
        "participant_id","iso_time","rt_ms",
        "event_type","event_name","reason",
        "trial_index","round","round_total",
        "turn_global","turn_index_in_round","active_agent","human_agent","controller",
        "move_index_in_turn","dir","dx","dy",
        "from_x","from_y","to_x","to_y","attempted_x","attempted_y","clamped",
        "forager_x","forager_y","security_x","security_y",
        "policy","rng","key"
      ];

      const set = new Set(allKeys);
      const out = [];

      for (const h of preferred) if (set.has(h)) out.push(h);

      const remaining = [...set].filter(k => !out.includes(k)).sort();
      return out.concat(remaining);
    }

    toCSV() {
      // Union all keys across all rows
      const keySet = new Set();
      for (const r of this.rows) {
        for (const k of Object.keys(r)) keySet.add(k);
      }

      // If no data, still return a minimal header
      if (keySet.size === 0) {
        return "participant_id,iso_time,rt_ms,event_type,event_name\n";
      }

      const headers = this._preferredHeaders(keySet);

      const esc = (v) => {
        const s = String(v ?? "");
        if (s.includes('"') || s.includes(",") || s.includes("\n")) {
          return `"${s.replaceAll('"', '""')}"`;
        }
        return s;
      };

      const lines = [headers.join(",")];
      for (const r of this.rows) {
        lines.push(headers.map((h) => esc(r[h])).join(","));
      }
      return lines.join("\n") + "\n";
    }

    downloadCSV(filenamePrefix = "gridgame") {
      const csv = this.toCSV();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const safePid = String(this.participantId || "unknown").replaceAll(/[^a-zA-Z0-9_-]/g, "_");
      const ts = new Date().toISOString().replaceAll(/[:.]/g, "-");

      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenamePrefix}_${safePid}_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    }
  }

  window.DataSaver = new DataSaver();
})();
