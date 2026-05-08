/* ===========================
   data_save.js
   Clean centralized logger + CSV export

   Output goal:
   - one clean CSV
   - rows separated by phase using the `phase` column
   - role actions use one schema for both human and agent/model actions
   - role is always the task role: forager or security
   - actor_type is always the controller: human or agent
   - survey rows keep raw selections only; no reverse coding or scale scoring
   =========================== */

(function () {
  "use strict";

  class DataSaver {
    constructor() {
      this.participantId = null;
      this.rows = [];
      this.sessionStartPerf = 0;
      this.lastSavedPerf = 0;
    }

    init(participantId) {
      if (!participantId) throw new Error("DataSaver.init requires participantId");
      this.participantId = participantId;
      this.rows = [];
      this.sessionStartPerf = performance.now();
      this.lastSavedPerf = this.sessionStartPerf;
    }

    log(evt) {
      evt = evt || {};
      const nowPerf = performance.now();
      const autoRt = Math.round(nowPerf - (this.lastSavedPerf || this.sessionStartPerf || nowPerf));
      const clean = this._normalizeRow(evt, autoRt);
      if (!clean) return;

      const eventName = String(evt.event_name || "").toLowerCase();
      const skipRtClockUpdate = evt.no_rt === true || eventName === "gold_mine_depleted" || eventName === "alien_chased_away";
      if (!skipRtClockUpdate) this.lastSavedPerf = nowPerf;

      this.rows.push({
        participant_id: this.participantId,
        iso_time: new Date().toISOString(),
        ...clean,
      });
    }

    _phase(evt) {
      const raw = String(evt.phase || evt.map_phase || evt.mode || evt.event_type || evt.trial_type || evt.survey_name || "").toLowerCase();
      const name = String(evt.event_name || "").toLowerCase();

      if (raw.includes("survey") || name.includes("survey")) return "survey";
      if (raw.includes("practice")) return "practice";
      if (raw.includes("observe") || raw.includes("observation") || name.includes("observation")) return "observation";
      if (raw.includes("main") || raw === "game") return "main";
      if (name.includes("ranking") || name.includes("pair_choice") || name.includes("pair_chosen")) return "choice";
      if (name.includes("game_end") || name.includes("session_end")) return evt.map_phase === "observe" ? "observation" : "main";
      return "system";
    }

    _isSurvey(evt) {
      const type = String(evt.event_type || "").toLowerCase();
      const name = String(evt.event_name || "").toLowerCase();
      const trial = String(evt.trial_type || "").toLowerCase();
      const survey = String(evt.survey_name || "").toLowerCase();

      // Skip task-level survey status logs; keep only the row created by the survey itself.
      if (type === "system" && (name === "survey_finished" || name === "survey_error" || name === "survey_skipped_missing_script" || name.startsWith("post_task_surveys"))) return false;

      const s = `${type} ${trial} ${survey} ${name}`;
      return type === "survey" || trial.includes("survey") || survey.includes("nfc") || survey.includes("bis") || survey.includes("five_dcr") || survey.includes("final_survey");
    }

    _isRoleAction(evt) {
      const name = String(evt.event_name || "").toLowerCase();
      const type = String(evt.event_type || "").toLowerCase();
      if (name === "move") return true;
      if (name === "action" || name === "action_invalid") return true;
      if (["forge", "dig", "scan_chase", "revive_forager", "revive"].includes(name)) return true;
      if (type === "action" || type === "model_action" || type === "action_invalid" || type === "model_action_invalid") return true;
      return false;
    }

    _keepSystemEvent(evt) {
      const name = String(evt.event_name || "").toLowerCase();
      return [
        "practice_start",
        "practice_end",
        "game_start",
        "game_end",
        "session_end",
        "observation_demo_start",
        "observation_demo_end",
        "agent_ranking_submitted",
        "pair_chosen",
        "gold_mine_depleted",
        "alien_chased_away",
        "fatal_error"
      ].includes(name);
    }

    _actorType(evt, phase, role = "") {
      // actor_type says who controlled the role: human or agent.
      // role itself should only be forager or security.
      if (phase === "observation") return "agent";

      const c = String(evt.actor_type || evt.controller || evt.source || "").toLowerCase();
      if (c === "human") return "human";
      if (c === "model" || c === "agent" || c === "ai") return "agent";

      // Main phase fallback if old rows only contain the assigned human role.
      const humanRole = this._roleValue(evt.human_role || evt.human_agent || "");
      if (phase === "main" && role && humanRole) return role === humanRole ? "human" : "agent";

      if (phase === "practice") return "human";
      return "";
    }

    _roleValue(v) {
      const r = String(v || "").toLowerCase();
      if (r.includes("forager")) return "forager";
      if (r.includes("security")) return "security";
      return "";
    }

    _role(evt) {
      // Exported role is intentionally restricted to the two task roles.
      // Named agents/Tom/Jerry and pre-role tutorial "player" rows should not appear as roles.
      const candidates = [
        evt.role,
        evt.agent,
        evt.controlled_role,
        evt.active_agent,
        evt.human_role,
        evt.human_agent,
      ];

      for (const c of candidates) {
        const role = this._roleValue(c);
        if (role) return role;
      }
      return "";
    }

    _actionName(evt) {
      const name = String(evt.event_name || "").toLowerCase();
      const role = this._role(evt);
      const key = String(evt.key || "").toLowerCase();

      if (name === "move") {
        const dir = String(evt.dir || "").toLowerCase();
        if (dir) return `move_${dir}`;
        if (Number(evt.dx) === 0 && Number(evt.dy) === -1) return "move_up";
        if (Number(evt.dx) === 0 && Number(evt.dy) === 1) return "move_down";
        if (Number(evt.dx) === -1 && Number(evt.dy) === 0) return "move_left";
        if (Number(evt.dx) === 1 && Number(evt.dy) === 0) return "move_right";
        return "move";
      }

      if (name === "forge") return "dig";
      if (name === "revive_forager") return "revive";
      if (name === "scan_chase") return "scan_chase";

      if (name === "action" || name === "action_invalid") {
        if (role === "forager" && key === "d") return "dig";
        if (role === "security" && key === "s") return "scan_chase";
        if (role === "security" && key === "r") return "revive";
        return key || name;
      }

      return name || "";
    }

    _numOrBlank(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : "";
    }

    _location(evt, role) {
      if (evt.agent_x != null && evt.agent_y != null) return { x: evt.agent_x, y: evt.agent_y };
      if (evt.to_x != null && evt.to_y != null) return { x: evt.to_x, y: evt.to_y };
      if (role === "forager" && evt.forager_x != null && evt.forager_y != null) return { x: evt.forager_x, y: evt.forager_y };
      if (role === "security" && evt.security_x != null && evt.security_y != null) return { x: evt.security_x, y: evt.security_y };
      return { x: "", y: "" };
    }

    _base(evt, phase, autoRt) {
      const eventName = String(evt.event_name || evt.trial_type || evt.survey_name || "").toLowerCase();
      const suppressRt = evt.no_rt === true || eventName === "gold_mine_depleted" || eventName === "alien_chased_away";

      return {
        phase,
        phase_index: evt.map_index ?? evt.stage_index ?? "",
        event_type: evt.event_type || "",
        event_name: evt.event_name || evt.trial_type || evt.survey_name || "",
        rt_ms: suppressRt ? "" : this._numOrBlank(evt.rt_ms ?? evt.rt ?? evt.total_time_ms ?? evt.final_survey_rt_total ?? evt.bisbas_survey_rt_total ?? evt.nfc_survey_rt_total ?? autoRt),
      };
    }

    _normalizeRoleAction(evt, autoRt) {
      const phase = this._phase(evt);
      const role = this._role(evt);
      if (!role) return null;

      const loc = this._location(evt, role);

      const out = {
        ...this._base(evt, phase, autoRt),
        event_type: "role_action",
        actor_type: this._actorType(evt, phase, role),
        role,
        action: this._actionName(evt),
        key: evt.key || "",
        repetition: evt.repetition ?? "",
        round: evt.round_in_rep ?? evt.round ?? "",
        turn_global: evt.turn_global ?? "",
        turn_index_in_round: evt.turn_index_in_round ?? "",
        move_index_in_turn: evt.move_index_in_turn ?? evt.move_index_in_turn_attempted ?? "",
        current_x: loc.x,
        current_y: loc.y,
        from_x: evt.from_x ?? "",
        from_y: evt.from_y ?? "",
        to_x: evt.to_x ?? "",
        to_y: evt.to_y ?? "",
        dx: evt.dx ?? "",
        dy: evt.dy ?? "",
        clamped: evt.clamped ?? "",
        success: evt.success ?? "",
        reason: evt.reason || "",
        forager_x: evt.forager_x ?? "",
        forager_y: evt.forager_y ?? "",
        security_x: evt.security_x ?? "",
        security_y: evt.security_y ?? "",
        gold_total: evt.gold_after ?? evt.gold_total ?? "",
        gold_delta: evt.gold_delta ?? "",
        forager_stun_turns: evt.forager_stun_turns ?? evt.forager_stun_turns_after ?? "",
        tile_gold_mine: evt.tile_gold_mine ?? "",
        tile_mine_type: evt.tile_mine_type ?? "",
        has_alien: evt.has_alien ?? "",
        chased_away: evt.chased_away ?? "",
        found_alien_count: evt.found_alien_count ?? "",
        found_alien_id: evt.found_alien_id ?? "",
        scan_center_x: evt.scan_center_x ?? "",
        scan_center_y: evt.scan_center_y ?? "",
        scanned_tile_count: evt.scanned_tile_count ?? "",
        map_name: evt.map_name || "",
        map_reward_level: evt.map_reward_level || "",
        map_risk_level: evt.map_risk_level || "",
        map_num: evt.map_num || "",
        partner_name: evt.partner_name || "",
        partner_role: evt.partner_role || "",
        human_role: evt.human_role || evt.human_agent || "",
      };

      return out;
    }

    _normalizeSurvey(evt, autoRt) {
      const surveyName = String(evt.survey_name || evt.trial_type || evt.event_name || "survey").replace(/_survey_complete$/i, "");
      const out = {
        ...this._base(evt, "survey", autoRt),
        event_type: "survey",
        event_name: "survey_complete",
        survey_name: surveyName,
      };

      for (const [k, v] of Object.entries(evt)) {
        if (/^(nfc_item_\d+|bisbas_item_\d+|fiveDCR_q\d+)$/i.test(k)) {
          out[k] = v;
          continue;
        }

        const rawMatch = k.match(/^(nfc_item_\d+|bisbas_item_\d+)_raw$/i);
        if (rawMatch) {
          out[rawMatch[1]] = v;
          continue;
        }

        if (/^(birth_year|age|sex|ethnicity|ethnicity_other_text|strategy_description|agent_ranking_order|agent_rank_\d+.*)$/i.test(k)) {
          out[k] = v;
        }
      }

      return out;
    }

    _normalizeSystem(evt, autoRt) {
      const phase = this._phase(evt);
      const out = {
        ...this._base(evt, phase, autoRt),
        event_type: "phase_event",
        event_name: evt.event_name || "",
        repetition: evt.repetition ?? "",
        round: evt.round_in_rep ?? evt.round ?? "",
        demo_label: evt.demo_label || "",
        chosen_index: evt.chosen_index ?? "",
        chosen_label: evt.chosen_label || "",
        agent_rank_order: evt.agent_rank_order || "",
        agent_rank_ids: evt.agent_rank_ids || "",
        agent_rank_roles: evt.agent_rank_roles || "",
        map_name: evt.map_name || "",
        map_reward_level: evt.map_reward_level || "",
        map_risk_level: evt.map_risk_level || "",
        map_num: evt.map_num || "",
        reason: evt.reason || evt.error || "",
        depletion_status: evt.depletion_status || "",
        chase_status: evt.chase_status || "",
        tile_x: evt.tile_x ?? "",
        tile_y: evt.tile_y ?? "",
        alien_id: evt.alien_id ?? evt.found_alien_id ?? "",
        alien_x: evt.alien_x ?? "",
        alien_y: evt.alien_y ?? "",
        found_alien_id: evt.found_alien_id ?? evt.alien_id ?? "",
        found_alien_count: evt.found_alien_count ?? "",
        scan_center_x: evt.scan_center_x ?? "",
        scan_center_y: evt.scan_center_y ?? "",
        mine_type_key: evt.mine_type_key || "",
        mine_type_raw: evt.mine_type_raw || "",
        decay_prob: evt.decay_prob ?? "",
        rng_u: evt.rng_u ?? "",
        gold_total: evt.gold_after ?? evt.gold_total ?? "",
      };

      for (let i = 1; i <= 6; i++) {
        if (evt[`rank_${i}_agent`] != null) out[`rank_${i}_agent`] = evt[`rank_${i}_agent`];
        if (evt[`rank_${i}_agent_id`] != null) out[`rank_${i}_agent_id`] = evt[`rank_${i}_agent_id`];
        if (evt[`rank_${i}_agent_role`] != null) out[`rank_${i}_agent_role`] = evt[`rank_${i}_agent_role`];
      }

      return out;
    }

    _normalizeRow(evt, autoRt) {
      if (this._isSurvey(evt)) return this._normalizeSurvey(evt, autoRt);
      if (this._isRoleAction(evt)) return this._normalizeRoleAction(evt, autoRt);
      if (this._keepSystemEvent(evt)) return this._normalizeSystem(evt, autoRt);
      return null;
    }

    _preferredHeaders(allKeys) {
      const preferred = [
        "participant_id", "iso_time", "phase", "phase_index", "event_type", "event_name", "survey_name",
        "actor_type", "role", "action", "key", "rt_ms",
        "repetition", "round", "turn_global", "turn_index_in_round", "move_index_in_turn",
        "current_x", "current_y", "from_x", "from_y", "to_x", "to_y", "dx", "dy", "clamped",
        "success", "reason",
        "forager_x", "forager_y", "security_x", "security_y", "forager_stun_turns",
        "gold_total", "gold_delta", "tile_gold_mine", "tile_mine_type", "tile_x", "tile_y", "depletion_status",
        "chase_status", "alien_id", "alien_x", "alien_y",
        "has_alien", "chased_away", "found_alien_count", "found_alien_id", "scan_center_x", "scan_center_y", "scanned_tile_count",
        "map_name", "map_reward_level", "map_risk_level", "map_num", "partner_name", "partner_role", "human_role",
        "demo_label", "chosen_index", "chosen_label", "agent_rank_order", "agent_rank_ids", "agent_rank_roles"
      ];

      const set = new Set(allKeys);
      const out = [];
      for (const h of preferred) if (set.has(h)) out.push(h);
      const remaining = [...set].filter(k => !out.includes(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return out.concat(remaining);
    }

    toCSV(phase = null) {
      const rows = phase ? this.rows.filter(r => r.phase === phase) : this.rows;
      const keySet = new Set();
      for (const r of rows) for (const k of Object.keys(r)) keySet.add(k);

      if (keySet.size === 0) {
        return "participant_id,iso_time,phase,event_type,event_name,actor_type,role,action,rt_ms,current_x,current_y\n";
      }

      const headers = this._preferredHeaders(keySet);
      const esc = (v) => {
        const s = String(v ?? "");
        if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`;
        return s;
      };

      const lines = [headers.join(",")];
      for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(","));
      return lines.join("\n") + "\n";
    }

    downloadCSV(filenamePrefix = "gridgame_clean") {
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
