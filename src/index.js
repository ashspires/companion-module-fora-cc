const http = require("node:http")
const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require("@companion-module/base")
var ACTIONS = [
  ["video_level", "Video Level", "proc%3Avlvl", 0, 2000, 1000],
  ["y_level", "Y Level", "proc%3Aylvl", 0, 2000, 1000],
  ["chroma", "Chroma", "proc%3Aclvl", 0, 2000, 1000],
  ["black_level", "Black Level", "proc%3Ablvl", -200, 1000, 0],
  ["hue", "Hue", "proc%3Ahue", -899, 900, 0],
  ["white_level_red", "White Level Red", "cc%3Awlvlr", 0, 2000, 1000],
  ["white_level_green", "White Level Green", "cc%3Awlvlg", 0, 2000, 1000],
  ["white_level_blue", "White Level Blue", "cc%3Awlvlb", 0, 2000, 1000],
  ["black_level_red", "Black Level Red", "cc%3Ablvlr", 0, 2000, 1000],
  ["black_level_green", "Black Level Green", "cc%3Ablvlg", 0, 2000, 1000],
  ["black_level_blue", "Black Level Blue", "cc%3Ablvlb", 0, 2000, 1000],
  ["gamma_level_red", "Gamma Level Red", "cc%3Aglvlr", 0, 2000, 1000],
  ["gamma_level_green", "Gamma Level Green", "cc%3Aglvlg", 0, 2000, 1000],
  ["gamma_level_blue", "Gamma Level Blue", "cc%3Aglvlb", 0, 2000, 1000],
  ["gamma_curve", "Gamma Curve", "cc%3Acurve", 0, 2, 0],
  ["bypass", "Bypass", "proc%3Abyp", 0, 1, 0],
  ["cc_mode", "CCMode", "cc%3Amode", 0, 1, 0]
];
var POLL_FIELDS = {
  video_level: ["videoLevel", 10], y_level: ["lumLevel", 10], chroma: ["chromaLevel", 10], black_level: ["blackLevel", 10], hue: ["hue", 10],
  white_level_red: ["whiteLevelRed", 10], white_level_green: ["whiteLevelGreen", 10], white_level_blue: ["whiteLevelBlue", 10],
  black_level_red: ["blackLevelRed", 10], black_level_green: ["blackLevelGreen", 10], black_level_blue: ["blackLevelBlue", 10],
  gamma_level_red: ["gammaLevelRed", 10], gamma_level_green: ["gammaLevelGreen", 10], gamma_level_blue: ["gammaLevelBlue", 10],
  gamma_curve: ["gammaCurve", 1], bypass: ["procBypass", 1], cc_mode: ["ccMode", 1]
};
var Fora1010Instance = class extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.config = {};
    this.selectedChannel = 1;
    this.values = {};
    this.presets = {};
    this.pollTimer = null;
    this.polling = false;
  }
  async init(config) {
    this.config = config || {};
    this.selectedChannel = this.safeStoredInteger(this.config.selected_channel_state, 1, 5, 1);
    this.presets = this.config.presets && typeof this.config.presets === "object" ? this.config.presets : {};
    this.initializeStoredValues();
    this.initVariables();
    this.initActions();
    this.startPolling();
  }
  async destroy() { this.stopPolling(); }
  async configUpdated(config) {
    this.config = config || {};
    this.presets = this.config.presets && typeof this.config.presets === "object" ? this.config.presets : this.presets;
    this.initActions();
    this.startPolling();
  }
  getConfigFields() {
    return [
      { type: "textinput", id: "host", label: "FORA-1010 IP address or hostname", width: 8, default: "10.232.2.58", regex: Regex.HOSTNAME },
      { type: "number", id: "port", label: "HTTP port", width: 4, default: 80, min: 1, max: 65535 },
      { type: "number", id: "poll_interval", label: "Polling interval (milliseconds)", width: 4, default: 10000, min: 250, max: 3600000, tooltip: "Polls video_param.cgi for all five channels. Default: 10000 ms (10 seconds)." }
    ];
  }
  initializeStoredValues() {
    for (let channel = 1; channel <= 5; channel++) for (const [id, _name, _command, _min, _max, defaultValue] of ACTIONS) {
      const key = this.valueKey(id, channel);
      if (!Number.isFinite(this.values[key])) this.values[key] = defaultValue;
    }
  }
  initVariables() {
    const definitions = [
      { variableId: "selected_channel", name: "Currently Selected Channel" }
    ];
    const initialValues = { selected_channel: this.selectedChannel };
    for (const [id, name] of ACTIONS) definitions.push({ variableId: `selected_${id}`, name: `Selected Channel ${name}` });
    for (let channel = 1; channel <= 5; channel++) for (const [id, name] of ACTIONS) {
      const variableId = this.valueKey(id, channel);
      definitions.push({ variableId, name: `Channel ${channel} ${name}` });
      initialValues[variableId] = this.values[variableId];
    }
    Object.assign(initialValues, this.selectedVariableUpdates());
    this.setVariableDefinitions(definitions);
    this.setVariableValues(initialValues);
  }
  valueKey(actionId, channel) { return `ch${channel}_${actionId}`; }
  selectedVariableUpdates() {
    const updates = { selected_channel: this.selectedChannel };
    for (const [id] of ACTIONS) updates[`selected_${id}`] = this.values[this.valueKey(id, this.selectedChannel)];
    return updates;
  }
  updateSelectedVariables() { this.setVariableValues(this.selectedVariableUpdates()); }
  channelOption() { return { type: "textinput", id: "channel", label: "Channel (1 to 5)", default: "1", useVariables: true, required: true, tooltip: "Companion Channel 1 maps to FORA fs=0; Channel 5 maps to fs=4" }; }
  presetOption() { return { type: "textinput", id: "preset", label: "Preset number (1 to 100)", default: "1", useVariables: true, required: true }; }
  initActions() {
    const definitions = {};
    for (const [id, name, command, min, max, defaultValue] of ACTIONS) {
      definitions[id] = { name: `Set ${name}`, options: [{ type: "textinput", id: "value", label: `Value (${min} to ${max})`, default: String(defaultValue), useVariables: true, required: true }, this.channelOption()], callback: async (action, context) => {
        const resolvedValue = await context.parseVariablesInString(String(action.options.value ?? defaultValue));
        const channel = await this.resolveChannel(action, context, name);
        const value = this.clampInteger(resolvedValue, min, max, `${name} value`);
        await this.sendAndStore(id, command, name, value, channel);
      }};
    }
    definitions.adjust_attribute = {
      name: "Adjust Attribute",
      options: [
        { type: "dropdown", id: "attribute", label: "Attribute", default: ACTIONS[0][0], choices: ACTIONS.map(([id, name]) => ({ id, label: name })) },
        { type: "dropdown", id: "direction", label: "Direction", default: "increase", choices: [{ id: "increase", label: "Increase" }, { id: "decrease", label: "Decrease" }] },
        { type: "textinput", id: "amount", label: "Amount", default: "1", useVariables: true, required: true, tooltip: "May contain a Companion variable, including a global custom variable." },
        this.channelOption()
      ],
      callback: async (action, context) => {
        const attribute = ACTIONS.find(([id]) => id === action.options.attribute);
        if (!attribute) throw new Error(`Unknown attribute: ${action.options.attribute}`);
        const [id, name, command, min, max] = attribute;
        const channel = await this.resolveChannel(action, context, name);
        const resolvedAmount = await context.parseVariablesInString(String(action.options.amount ?? "1"));
        const amount = this.clampInteger(resolvedAmount, 0, 2000, "Adjustment amount");
        const direction = action.options.direction === "decrease" ? -1 : 1;
        await this.adjustAndSend(id, command, name, min, max, channel, direction, amount);
      }
    };
    definitions.set_selected_channel = { name: "Set Currently Selected Channel", options: [this.channelOption()], callback: async (action, context) => {
      const resolved = await context.parseVariablesInString(String(action.options.channel ?? "1"));
      this.selectedChannel = this.clampInteger(resolved, 1, 5, "Selected channel");
      this.config.selected_channel_state = this.selectedChannel;
      this.saveConfig(this.config);
      this.updateSelectedVariables();
      this.log("info", `Selected channel set to ${this.selectedChannel}`);
    }};
    definitions.store_preset = { name: "Store Preset", options: [this.channelOption(), this.presetOption()], callback: async (action, context) => {
      const channel = await this.resolveChannel(action, context, "Store preset");
      const preset = await this.resolvePreset(action, context);
      const snapshot = {};
      for (const [id] of ACTIONS) snapshot[id] = this.values[this.valueKey(id, channel)];
      if (!this.presets[String(preset)]) this.presets[String(preset)] = {};
      this.presets[String(preset)][String(channel)] = snapshot;
      this.persistState();
      this.log("info", `Stored channel ${channel} in preset ${preset}`);
    }};
    definitions.recall_preset = { name: "Recall Preset", options: [this.channelOption(), this.presetOption()], callback: async (action, context) => {
      const channel = await this.resolveChannel(action, context, "Recall preset");
      const preset = await this.resolvePreset(action, context);
      const snapshot = this.presets[String(preset)]?.[String(channel)];
      if (!snapshot) throw new Error(`Preset ${preset} has no stored data for channel ${channel}`);
      for (const [id, name, command, min, max] of ACTIONS) {
        if (snapshot[id] === undefined) continue;
        const value = this.clampInteger(snapshot[id], min, max, `${name} preset value`);
        await this.sendAndStore(id, command, name, value, channel);
      }
      this.log("info", `Recalled preset ${preset} to channel ${channel}`);
    }};
    definitions.poll_now = { name: "Poll all channels now", options: [], callback: async () => this.pollAllChannels() };
    this.setActionDefinitions(definitions);
  }
  persistState() {
    this.config.presets = this.presets;
    this.config.selected_channel_state = this.selectedChannel;
    this.saveConfig(this.config);
  }
  getPollInterval() { const configured = Number(this.config.poll_interval); return Number.isFinite(configured) ? Math.min(3600000, Math.max(250, Math.round(configured))) : 10000; }
  startPolling() { this.stopPolling(); this.pollAllChannels(); this.pollTimer = setInterval(() => this.pollAllChannels(), this.getPollInterval()); }
  stopPolling() { if (this.pollTimer) clearInterval(this.pollTimer); this.pollTimer = null; }
  async pollAllChannels() {
    if (this.polling) return;
    this.polling = true;
    try {
      const results = await Promise.allSettled([0,1,2,3,4].map((fs) => this.pollChannel(fs)));
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length === 0) this.updateStatus(InstanceStatus.Ok);
      else if (failures.length === 5) this.updateStatus(InstanceStatus.ConnectionFailure, failures[0].reason?.message || "Polling failed");
      else this.updateStatus(InstanceStatus.UnknownWarning, `${failures.length} of 5 channels failed to poll`);
    } finally { this.polling = false; }
  }
  async pollChannel(fs) {
    const data = await this.sendGet(fs);
    const channel = fs + 1;
    const updates = {};
    for (const [id, [jsonField, scale]] of Object.entries(POLL_FIELDS)) {
      const raw = data[jsonField]; if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const action = ACTIONS.find((item) => item[0] === id); if (!action) continue;
      const value = this.clampInteger(raw * scale, action[3], action[4], `${action[1]} polled value`);
      const key = this.valueKey(id, channel); this.values[key] = value; updates[key] = value;
      if (channel === this.selectedChannel) updates[`selected_${id}`] = value;
    }
    if (Object.keys(updates).length > 0) this.setVariableValues(updates);
  }
  async resolveChannel(action, context, name) { const resolved = await context.parseVariablesInString(String(action.options.channel ?? "1")); return this.clampInteger(resolved, 1, 5, `${name} channel`); }
  async resolvePreset(action, context) { const resolved = await context.parseVariablesInString(String(action.options.preset ?? "1")); return this.clampInteger(resolved, 1, 100, "Preset number"); }
  async adjustAndSend(id, command, name, min, max, channel, direction, amount) { const key = this.valueKey(id, channel); const current = Number.isFinite(this.values[key]) ? this.values[key] : 0; const value = this.clampInteger(current + direction * amount, min, max, `${name} value`); await this.sendAndStore(id, command, name, value, channel); }
  async sendAndStore(id, command, name, value, channel) {
    const body = Buffer.from(`${command}=${value}`, "ascii");
    await this.sendPost(body, channel - 1);
    const key = this.valueKey(id, channel); this.values[key] = value;
    const updates = { [key]: value }; if (channel === this.selectedChannel) updates[`selected_${id}`] = value;
    this.setVariableValues(updates);
  }
  safeStoredInteger(input, min, max, fallback) { const n = Number(input); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; }
  clampInteger(input, min, max, label) {
    const numeric = Number(String(input).trim());
    if (!Number.isFinite(numeric)) { const message = `${label} must resolve to a number; received \"${input}\"`; this.log("error", message); throw new Error(message); }
    const rounded = Math.round(numeric), clamped = Math.min(max, Math.max(min, rounded));
    if (clamped !== rounded) this.log("warn", `${label} ${rounded} was clamped to ${clamped} (allowed range ${min}-${max})`);
    return clamped;
  }
  requestOptions(method, path, headers = {}) { return { host: String(this.config.host || "10.232.2.58").trim(), port: Number(this.config.port || 80), method, path, headers: { Connection: "close", ...headers }, agent: false }; }
  sendGet(fs) { return new Promise((resolve, reject) => {
    const req = http.request(this.requestOptions("GET", `/video_param.cgi?fs=${fs}`, { Accept: "application/json" }), (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (!(res.statusCode >= 200 && res.statusCode < 400)) return reject(new Error(`FORA GET channel ${fs + 1} returned HTTP ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`Invalid JSON from FORA channel ${fs + 1}: ${error.message}`)); }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error(`FORA GET channel ${fs + 1} timed out`)));
    req.on("error", (error) => { this.log("warn", `FORA GET channel ${fs + 1} failed: ${error.message}`); reject(error); }); req.end();
  }); }
  sendPost(body, fs) { return new Promise((resolve, reject) => {
    const req = http.request(this.requestOptions("POST", `/post_video.cgi?fs=${fs}`, { "Content-Type": "text/plain", "Content-Length": body.length }), (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 400) { this.updateStatus(InstanceStatus.Ok); resolve(); }
        else { const message = `FORA returned HTTP ${res.statusCode}: ${responseBody}`; this.updateStatus(InstanceStatus.ConnectionFailure, message); reject(new Error(message)); }
      });
    });
    req.setTimeout(3000, () => req.destroy(new Error("HTTP request timed out")));
    req.on("error", (error) => { this.updateStatus(InstanceStatus.ConnectionFailure, error.message); this.log("error", `FORA POST failed: ${error.message}`); reject(error); }); req.end(body);
  }); }
};
runEntrypoint(Fora1010Instance, []);
