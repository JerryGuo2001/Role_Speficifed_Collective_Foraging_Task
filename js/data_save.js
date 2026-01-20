/* ===========================
   data_save.js
   - Owns all data logging + CSV generation + download
   - Exposes window.DataSaver
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

    toCSV() {
      if (this.rows.length === 0) {
        return "participant_id,iso_time,rt_ms,event_type,event_name\n";
      }
      const headers = Object.keys(this.rows[0]);
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

  // singleton
  window.DataSaver = new DataSaver();
})();
