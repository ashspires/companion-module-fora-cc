const http = require("node:http")
const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require("@companion-module/base")

// ─── Parameter definitions ───────────────────────────────────────────────────
// [id, displayName, postCommand, min, max, default]
var ACTIONS = [
  ["video_level",       "Video Level",       "proc%3Avlvl", 0,    2000, 1000],
  ["y_level",           "Y Level",           "proc%3Aylvl", 0,    2000, 1000],
  ["chroma",            "Chroma",            "proc%3Aclvl", 0,    2000, 1000],
  ["black_level",       "Black Level",       "proc%3Ablvl", -200, 1000, 0   ],
  ["hue",               "Hue",               "proc%3Ahue",  -899, 900,  0   ],
  ["white_level_red",   "White Level Red",   "cc%3Awlvlr",  0,    2000, 1000],
  ["white_level_green", "White Level Green", "cc%3Awlvlg",  0,    2000, 1000],
  ["white_level_blue",  "White Level Blue",  "cc%3Awlvlb",  0,    2000, 1000],
  ["black_level_red",   "Black Level Red",   "cc%3Ablvlr",  0,    2000, 1000],
  ["black_level_green", "Black Level Green", "cc%3Ablvlg",  0,    2000, 1000],
  ["black_level_blue",  "Black Level Blue",  "cc%3Ablvlb",  0,    2000, 1000],
  ["gamma_level_red",   "Gamma Level Red",   "cc%3Aglvlr",  0,    2000, 1000],
  ["gamma_level_green", "Gamma Level Green", "cc%3Aglvlg",  0,    2000, 1000],
  ["gamma_level_blue",  "Gamma Level Blue",  "cc%3Aglvlb",  0,    2000, 1000],
  ["gamma_curve",       "Gamma Curve",       "cc%3Acurve",  0,    2,    0   ],
  ["bypass",            "Bypass",            "proc%3Abyp",  0,    1,    0   ],
  ["cc_mode",           "CCMode",            "cc%3Amode",   0,    1,    0   ],
  ["color_temp",        "Colour Temperature","__color_temp",-100, 100,  0   ],
  ["gamma_master",      "Gamma Master (RGB)","__gamma_master", 0, 2000, 1000],
]

// Parameters excluded from offset/reset operations (non-numeric or compound)
var COMPOUND_ATTRIBUTES = ["color_temp", "gamma_master"]

// Parameters included in reset and offset operations
var OFFSET_PARAMS = [
  "video_level", "y_level", "chroma", "black_level", "hue",
  "white_level_red", "white_level_green", "white_level_blue",
  "black_level_red", "black_level_green", "black_level_blue",
  "gamma_level_red", "gamma_level_green", "gamma_level_blue",
]

// Maps JSON response fields to [actionId, scale]
var POLL_FIELDS = {
  video_level:       ["videoLevel",      10],
  y_level:           ["lumLevel",        10],
  chroma:            ["chromaLevel",     10],
  black_level:       ["blackLevel",      10],
  hue:               ["hue",            10],
  white_level_red:   ["whiteLevelRed",   10],
  white_level_green: ["whiteLevelGreen", 10],
  white_level_blue:  ["whiteLevelBlue",  10],
  black_level_red:   ["blackLevelRed",   10],
  black_level_green: ["blackLevelGreen", 10],
  black_level_blue:  ["blackLevelBlue",  10],
  gamma_level_red:   ["gammaLevelRed",   10],
  gamma_level_green: ["gammaLevelGreen", 10],
  gamma_level_blue:  ["gammaLevelBlue",  10],
  gamma_curve:       ["gammaCurve",       1],
  bypass:            ["procBypass",       1],
  cc_mode:           ["ccMode",           1],
}

var TOGGLE_ATTRIBUTES = ["bypass", "cc_mode", "gamma_curve"]
var NUM_PRESETS  = 100
var NUM_CHANNELS = 5
var NUM_OFFSET_SLOTS = 2

var Fora1010Instance = class extends InstanceBase {

  constructor(internal) {
    super(internal)
    this.config          = {}
    this.selectedChannel = 1
    this.values          = {}
    this.presets         = {}
    this.snapshots       = {}   // channel -> param snapshot for offset recording
    this.offsets         = {}   // slot -> channel -> param -> delta
    this.pollTimer       = null
    this.polling         = false
    this.presetSavedTimer = null
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async init(config) {
    this.config          = config || {}
    this.selectedChannel = this.safeStoredInteger(this.config.selected_channel_state, 1, NUM_CHANNELS, 1)
    this.presets         = this.config.presets  && typeof this.config.presets  === "object" ? this.config.presets  : {}
    this.offsets         = this.config.offsets  && typeof this.config.offsets  === "object" ? this.config.offsets  : {}
    this.initializeStoredValues()
    this.initVariables()
    this.initActions()
    this.startPolling()
  }

  async destroy() {
    this.stopPolling()
    if (this.presetSavedTimer) clearTimeout(this.presetSavedTimer)
  }

  async configUpdated(config) {
    this.config  = config || {}
    this.presets = this.config.presets && typeof this.config.presets === "object" ? this.config.presets : this.presets
    this.offsets = this.config.offsets && typeof this.config.offsets === "object" ? this.config.offsets : this.offsets
    this.initActions()
    this.startPolling()
  }

  // ─── Config fields ──────────────────────────────────────────────────────────

  getConfigFields() {
    return [
      { type: "textinput", id: "host",          label: "FORA-1010 IP address or hostname", width: 8, default: "10.232.2.58", regex: Regex.HOSTNAME },
      { type: "number",    id: "port",          label: "HTTP port",                        width: 4, default: 80,    min: 1,   max: 65535   },
      { type: "number",    id: "poll_interval", label: "Polling interval (milliseconds)",  width: 4, default: 10000, min: 250, max: 3600000,
        tooltip: "Polls video_param.cgi for all five channels. Default: 10000 ms (10 seconds)." },
    ]
  }

  // ─── Variables ─────────────────────────────────────────────────────────────

  initializeStoredValues() {
    for (let channel = 1; channel <= NUM_CHANNELS; channel++) {
      for (const [id, _name, _command, _min, _max, defaultValue] of ACTIONS) {
        if (COMPOUND_ATTRIBUTES.includes(id)) continue
        const key = this.valueKey(id, channel)
        if (!Number.isFinite(this.values[key])) this.values[key] = defaultValue
      }
    }
  }

  initVariables() {
    const definitions  = [
      { variableId: "selected_channel", name: "Currently Selected Channel" },
      { variableId: "preset_held",      name: "Preset button currently held (0 = none)" },
      { variableId: "preset_saved",     name: "Preset slot last saved (0 = none, clears after 1.5s)" },
    ]
    const initialValues = {
      selected_channel: this.selectedChannel,
      preset_held:      0,
      preset_saved:     0,
    }

    // selected_* variables
    for (const [id, name] of ACTIONS) {
      if (COMPOUND_ATTRIBUTES.includes(id)) continue
      definitions.push({ variableId: `selected_${id}`, name: `Selected Channel ${name}` })
    }

    // ch{N}_{id} variables
    for (let channel = 1; channel <= NUM_CHANNELS; channel++) {
      for (const [id, name] of ACTIONS) {
        if (COMPOUND_ATTRIBUTES.includes(id)) continue
        const variableId = this.valueKey(id, channel)
        definitions.push({ variableId, name: `Channel ${channel} ${name}` })
        initialValues[variableId] = this.values[variableId]
      }
    }

    // preset_stored_{preset}_{channel}
    for (let preset = 1; preset <= NUM_PRESETS; preset++) {
      for (let channel = 1; channel <= NUM_CHANNELS; channel++) {
        const variableId = this.presetStoredKey(preset, channel)
        definitions.push({ variableId, name: `Preset ${preset} Channel ${channel} has stored data` })
        initialValues[variableId] = this.presetHasData(preset, channel)
      }
    }

    // Offset state variables per channel
    for (let channel = 1; channel <= NUM_CHANNELS; channel++) {
      definitions.push({ variableId: `offset_recording_ch${channel}`, name: `Channel ${channel} offset recording active` })
      definitions.push({ variableId: `offset_active_slot_ch${channel}`, name: `Channel ${channel} active offset slot (0=none)` })
      initialValues[`offset_recording_ch${channel}`]   = false
      initialValues[`offset_active_slot_ch${channel}`] = 0
      // Offset delta variables per slot per param
      for (let slot = 1; slot <= NUM_OFFSET_SLOTS; slot++) {
        for (const id of OFFSET_PARAMS) {
          const variableId = this.offsetKey(slot, channel, id)
          definitions.push({ variableId, name: `Offset slot ${slot} ch${channel} ${id}` })
          initialValues[variableId] = this.offsets[slot]?.[channel]?.[id] ?? 0
        }
      }
    }

    Object.assign(initialValues, this.selectedVariableUpdates())
    this.setVariableDefinitions(definitions)
    this.setVariableValues(initialValues)
  }

  valueKey(actionId, channel)          { return `ch${channel}_${actionId}` }
  presetStoredKey(preset, channel)     { return `preset_stored_${preset}_${channel}` }
  offsetKey(slot, channel, id)         { return `offset_slot_${slot}_ch${channel}_${id}` }
  presetHasData(preset, channel)       { return !!(this.presets[String(preset)]?.[String(channel)]) }
  offsetHasData(slot, channel)         { return !!(this.offsets[slot]?.[channel]) }

  updatePresetStoredVariable(preset, channel) {
    this.setVariableValues({ [this.presetStoredKey(preset, channel)]: this.presetHasData(preset, channel) })
  }

  selectedVariableUpdates() {
    const updates = { selected_channel: this.selectedChannel }
    for (const [id] of ACTIONS) {
      if (COMPOUND_ATTRIBUTES.includes(id)) continue
      updates[`selected_${id}`] = this.values[this.valueKey(id, this.selectedChannel)]
    }
    return updates
  }

  updateSelectedVariables() { this.setVariableValues(this.selectedVariableUpdates()) }

  // ─── Action option helpers ──────────────────────────────────────────────────

  channelOption() {
    return { type: "textinput", id: "channel", label: "Channel (1 to 5)", default: "1", useVariables: true, required: true,
      tooltip: "Companion Channel 1 maps to FORA fs=0; Channel 5 maps to fs=4" }
  }

  attributeOption(filterIds = null) {
    const choices = ACTIONS
      .filter(([id]) => filterIds === null || filterIds.includes(id))
      .map(([id, name]) => ({ id, label: name }))
    return { type: "dropdown", id: "attribute", label: "Attribute", default: choices[0].id, choices }
  }

  presetOption() {
    return { type: "textinput", id: "preset", label: "Preset number (1 to 100)", default: "1", useVariables: true, required: true }
  }

  slotOption() {
    return { type: "dropdown", id: "slot", label: "Offset slot", default: "1",
      choices: [{ id: "1", label: "Slot 1" }, { id: "2", label: "Slot 2" }] }
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  initActions() {
    const definitions = {}

    // ── Set Attribute ──────────────────────────────────────────────────────────
    definitions.set_attribute = {
      name: "Set Attribute",
      options: [ this.attributeOption(),
        { type: "textinput", id: "value", label: "Value", default: "0", useVariables: true, required: true,
          tooltip: "May contain a Companion variable. Values outside the selected attribute's range are clamped." },
        this.channelOption() ],
      callback: async (action, context) => {
        const attribute = ACTIONS.find(([id]) => id === action.options.attribute)
        if (!attribute) throw new Error(`Unknown attribute: ${action.options.attribute}`)
        const [id, name, , min, max] = attribute
        const resolvedValue = await context.parseVariablesInString(String(action.options.value ?? "0"))
        const channel = await this.resolveChannel(action, context, name)
        const value   = this.clampInteger(resolvedValue, min, max, `${name} value`)
        if (id === "color_temp") {
          await this.applyColorTemp(value, channel)
        } else if (id === "gamma_master") {
          await this.applyGammaMaster(value, channel, "set")
        } else {
          const [, , command] = attribute
          await this.sendAndStore(id, command, name, value, channel)
        }
      },
    }

    // ── Adjust Attribute ───────────────────────────────────────────────────────
    definitions.adjust_attribute = {
      name: "Adjust Attribute",
      options: [ this.attributeOption(),
        { type: "dropdown", id: "direction", label: "Direction", default: "increase",
          choices: [{ id: "increase", label: "Increase" }, { id: "decrease", label: "Decrease" }] },
        { type: "textinput", id: "amount", label: "Amount", default: "1", useVariables: true, required: true,
          tooltip: "May contain a Companion variable, including a global custom variable." },
        this.channelOption() ],
      callback: async (action, context) => {
        const attribute = ACTIONS.find(([id]) => id === action.options.attribute)
        if (!attribute) throw new Error(`Unknown attribute: ${action.options.attribute}`)
        const [id, name, command, min, max] = attribute
        const channel        = await this.resolveChannel(action, context, name)
        const resolvedAmount = await context.parseVariablesInString(String(action.options.amount ?? "1"))
        const amount         = this.clampInteger(resolvedAmount, 0, 2000, "Adjustment amount")
        const direction      = action.options.direction === "decrease" ? -1 : 1
        if (id === "color_temp") {
          await this.applyColorTemp(direction * amount, channel)
        } else if (id === "gamma_master") {
          await this.applyGammaMaster(direction * amount, channel, "adjust")
        } else {
          await this.adjustAndSend(id, command, name, min, max, channel, direction, amount)
        }
      },
    }

    // ── Toggle Attribute ───────────────────────────────────────────────────────
    definitions.toggle_attribute = {
      name: "Toggle Attribute",
      options: [ this.attributeOption(TOGGLE_ATTRIBUTES), this.channelOption() ],
      callback: async (action, context) => {
        const attribute = ACTIONS.find(([id]) => id === action.options.attribute)
        if (!attribute) throw new Error(`Unknown attribute: ${action.options.attribute}`)
        const [id, name, command, min, max] = attribute
        const channel = await this.resolveChannel(action, context, name)
        const key     = this.valueKey(id, channel)
        const current = Number.isFinite(this.values[key]) ? this.values[key] : min
        const next    = current >= max ? min : current + 1
        await this.sendAndStore(id, command, name, next, channel)
        this.log("info", `Toggled ${name} ch${channel}: ${current} → ${next}`)
      },
    }

    // ── Set Selected Channel ───────────────────────────────────────────────────
    definitions.set_selected_channel = {
      name: "Set Currently Selected Channel",
      options: [ this.channelOption() ],
      callback: async (action, context) => {
        const resolved = await context.parseVariablesInString(String(action.options.channel ?? "1"))
        this.selectedChannel = this.clampInteger(resolved, 1, NUM_CHANNELS, "Selected channel")
        this.config.selected_channel_state = this.selectedChannel
        this.saveConfig(this.config)
        this.updateSelectedVariables()
        this.log("info", `Selected channel set to ${this.selectedChannel}`)
      },
    }

    // ── Store Preset ───────────────────────────────────────────────────────────
    definitions.store_preset = {
      name: "Store Preset",
      options: [ this.channelOption(), this.presetOption() ],
      callback: async (action, context) => {
        const channel  = await this.resolveChannel(action, context, "Store preset")
        const preset   = await this.resolvePreset(action, context)
        const snapshot = {}
        for (const [id] of ACTIONS) {
          if (COMPOUND_ATTRIBUTES.includes(id)) continue
          snapshot[id] = this.values[this.valueKey(id, channel)]
        }
        if (!this.presets[String(preset)]) this.presets[String(preset)] = {}
        this.presets[String(preset)][String(channel)] = snapshot
        this.persistState()
        this.updatePresetStoredVariable(preset, channel)
        if (this.presetSavedTimer) clearTimeout(this.presetSavedTimer)
        this.setVariableValues({ preset_held: 0, preset_saved: preset })
        this.presetSavedTimer = setTimeout(() => {
          this.setVariableValues({ preset_saved: 0 })
          this.presetSavedTimer = null
        }, 1500)
        this.log("info", `Stored channel ${channel} in preset ${preset}`)
      },
    }

    // ── Recall Preset ──────────────────────────────────────────────────────────
    definitions.recall_preset = {
      name: "Recall Preset",
      options: [ this.channelOption(), this.presetOption() ],
      callback: async (action, context) => {
        const channel  = await this.resolveChannel(action, context, "Recall preset")
        const preset   = await this.resolvePreset(action, context)
        const snapshot = this.presets[String(preset)]?.[String(channel)]
        if (!snapshot) throw new Error(`Preset ${preset} has no stored data for channel ${channel}`)
        const recallItems = ACTIONS
          .filter(([id]) => !COMPOUND_ATTRIBUTES.includes(id) && snapshot[id] !== undefined)
          .map(([id, name, command, min, max]) => {
            const value = this.clampInteger(snapshot[id], min, max, `${name} preset value`)
            return [id, command, name, value]
          })
        await this.sendAndStoreMulti(recallItems, channel)
        this.log("info", `Recalled preset ${preset} to channel ${channel}`)
      },
    }

    // ── Set Preset Held State ──────────────────────────────────────────────────
    definitions.set_preset_held = {
      name: "Set Preset Held State",
      options: [{ type: "textinput", id: "preset", label: "Preset number (0 to clear)", default: "0",
        useVariables: true, required: true,
        tooltip: "Set to the preset number on button press, 0 on short release. Drives preset_held variable for feedback." }],
      callback: async (action, context) => {
        const resolved = await context.parseVariablesInString(String(action.options.preset ?? "0"))
        const preset   = Number(resolved.trim())
        const value    = Number.isFinite(preset) ? Math.max(0, Math.round(preset)) : 0
        this.setVariableValues({ preset_held: value })
      },
    }

    // ── Reset All to Default ───────────────────────────────────────────────────
    definitions.reset_to_default = {
      name: "Reset All to Default",
      options: [ this.channelOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Reset to default")
        const resetItems = ACTIONS
          .filter(([id]) => !COMPOUND_ATTRIBUTES.includes(id))
          .map(([id, name, command, , , defaultValue]) => [id, command, name, defaultValue])
        await this.sendAndStoreMulti(resetItems, channel)
        this.log("info", `Reset all parameters to default on ch${channel}`)
      },
    }

    // ── Start Offset Recording ─────────────────────────────────────────────────
    // Saves a snapshot of current values — operator then makes adjustments
    definitions.start_offset_recording = {
      name: "Start Offset Recording",
      options: [ this.channelOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Start offset recording")
        // Save current values as snapshot
        this.snapshots[channel] = {}
        for (const id of OFFSET_PARAMS) {
          this.snapshots[channel][id] = this.values[this.valueKey(id, channel)] ?? 0
        }
        this.setVariableValues({ [`offset_recording_ch${channel}`]: true })
        this.log("info", `Offset recording started for ch${channel}`)
      },
    }

    // ── Stop Offset Recording ──────────────────────────────────────────────────
    // Calculates delta between snapshot and current values, saves as offset slot
    definitions.stop_offset_recording = {
      name: "Stop Offset Recording",
      options: [ this.channelOption(), this.slotOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Stop offset recording")
        const slot    = Number(action.options.slot ?? 1)
        if (!this.snapshots[channel]) throw new Error(`No snapshot found for channel ${channel} — did you press Start Offset Recording first?`)
        // Calculate deltas
        if (!this.offsets[slot])          this.offsets[slot]          = {}
        if (!this.offsets[slot][channel]) this.offsets[slot][channel] = {}
        const variableUpdates = { [`offset_recording_ch${channel}`]: false }
        for (const id of OFFSET_PARAMS) {
          const snapshot = this.snapshots[channel][id] ?? 0
          const current  = this.values[this.valueKey(id, channel)] ?? 0
          const delta    = current - snapshot
          this.offsets[slot][channel][id] = delta
          variableUpdates[this.offsetKey(slot, channel, id)] = delta
        }
        this.setVariableValues(variableUpdates)
        this.persistState()
        delete this.snapshots[channel]
        this.log("info", `Offset recording stopped for ch${channel}, saved to slot ${slot}`)
      },
    }

    // ── Apply Offset ───────────────────────────────────────────────────────────
    // Adds saved offset deltas to current values
    definitions.apply_offset = {
      name: "Apply Offset",
      options: [ this.channelOption(), this.slotOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Apply offset")
        const slot    = Number(action.options.slot ?? 1)
        const slotData = this.offsets[slot]?.[channel]
        if (!slotData) throw new Error(`No offset data in slot ${slot} for channel ${channel}`)
        const applyItems = ACTIONS
          .filter(([id]) => OFFSET_PARAMS.includes(id))
          .map(([id, name, command, min, max]) => {
            const delta   = slotData[id] ?? 0
            const current = this.values[this.valueKey(id, channel)] ?? 0
            const value   = this.clampInteger(current + delta, min, max, `${name} offset`)
            return [id, command, name, value]
          })
        await this.sendAndStoreMulti(applyItems, channel)
        this.setVariableValues({ [`offset_active_slot_ch${channel}`]: slot })
        this.log("info", `Applied offset slot ${slot} to ch${channel}`)
      },
    }

    // ── Remove Offset ──────────────────────────────────────────────────────────
    // Subtracts the currently active offset deltas from current values
    definitions.remove_offset = {
      name: "Remove Offset",
      options: [ this.channelOption(), this.slotOption() ],
      callback: async (action, context) => {
        const channel  = await this.resolveChannel(action, context, "Remove offset")
        const slot     = Number(action.options.slot ?? 1)
        const slotData = this.offsets[slot]?.[channel]
        if (!slotData) throw new Error(`No offset data in slot ${slot} for channel ${channel}`)
        const removeItems = ACTIONS
          .filter(([id]) => OFFSET_PARAMS.includes(id))
          .map(([id, name, command, min, max]) => {
            const delta   = slotData[id] ?? 0
            const current = this.values[this.valueKey(id, channel)] ?? 0
            const value   = this.clampInteger(current - delta, min, max, `${name} offset remove`)
            return [id, command, name, value]
          })
        await this.sendAndStoreMulti(removeItems, channel)
        this.setVariableValues({ [`offset_active_slot_ch${channel}`]: 0 })
        this.log("info", `Removed offset slot ${slot} from ch${channel}`)
      },
    }

    // ── Adjust Offset ──────────────────────────────────────────────────────────
    // Fine-tunes a specific parameter's delta in a stored offset slot
    // Useful for tweaking offsets under changing lighting conditions
    definitions.adjust_offset = {
      name: "Adjust Offset Delta",
      options: [
        this.attributeOption(OFFSET_PARAMS),
        { type: "dropdown", id: "direction", label: "Direction", default: "increase",
          choices: [{ id: "increase", label: "Increase delta" }, { id: "decrease", label: "Decrease delta" }] },
        { type: "textinput", id: "amount", label: "Amount", default: "1", useVariables: true, required: true },
        this.channelOption(),
        this.slotOption(),
      ],
      callback: async (action, context) => {
        const channel        = await this.resolveChannel(action, context, "Adjust offset")
        const slot           = Number(action.options.slot ?? 1)
        const id             = action.options.attribute
        const resolvedAmount = await context.parseVariablesInString(String(action.options.amount ?? "1"))
        const amount         = this.clampInteger(resolvedAmount, 0, 2000, "Offset adjustment amount")
        const direction      = action.options.direction === "decrease" ? -1 : 1
        if (!this.offsets[slot])          this.offsets[slot]          = {}
        if (!this.offsets[slot][channel]) this.offsets[slot][channel] = {}
        const currentDelta = this.offsets[slot][channel][id] ?? 0
        const newDelta     = currentDelta + (direction * amount)
        this.offsets[slot][channel][id] = newDelta
        this.setVariableValues({ [this.offsetKey(slot, channel, id)]: newDelta })
        this.persistState()
        this.log("info", `Adjusted offset slot ${slot} ch${channel} ${id}: ${currentDelta} → ${newDelta}`)
      },
    }

    // ── Colour Temperature ─────────────────────────────────────────────────────
    definitions.adjust_color_temp = {
      name: "Adjust Colour Temperature (Planckian R/B)",
      options: [
        { type: "dropdown", id: "direction", label: "Direction", default: "warm",
          choices: [{ id: "warm", label: "Warmer (increase R, decrease B)" }, { id: "cool", label: "Cooler (decrease R, increase B)" }] },
        { type: "textinput", id: "amount", label: "Step amount (1 to 100)", default: "10", useVariables: true, required: true,
          tooltip: "May contain a Companion variable. Clamped to 1-100." },
        this.channelOption(),
      ],
      callback: async (action, context) => {
        const channel        = await this.resolveChannel(action, context, "Colour temperature")
        const resolvedAmount = await context.parseVariablesInString(String(action.options.amount ?? "10"))
        const amount         = this.clampInteger(resolvedAmount, 1, 100, "Colour temperature step")
        const direction      = action.options.direction === "cool" ? -1 : 1
        await this.applyColorTemp(direction * amount, channel)
        this.log("info", `ColourTemp ${action.options.direction} step=${amount} ch${channel}`)
      },
    }

    definitions.reset_color_temp = {
      name: "Reset Colour Temperature to Neutral",
      options: [ this.channelOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Reset colour temperature")
        await this.sendAndStoreMulti([
          ["white_level_red",  "cc%3Awlvlr", "White Level Red",  1000],
          ["white_level_blue", "cc%3Awlvlb", "White Level Blue", 1000],
        ], channel)
        this.log("info", `ColourTemp reset to neutral ch${channel}`)
      },
    }

    // ── Reset Gamma Master ────────────────────────────────────────────────────
    // Resets Red, Green and Blue gamma channels to default (1000) in one POST
    definitions.reset_gamma_master = {
      name: "Reset Gamma Master to Default",
      options: [ this.channelOption() ],
      callback: async (action, context) => {
        const channel = await this.resolveChannel(action, context, "Reset gamma master")
        await this.applyGammaMaster(1000, channel, "set")
        this.log("info", `Gamma Master reset to default ch${channel}`)
      },
    }

    // ── Poll Now ───────────────────────────────────────────────────────────────
    definitions.poll_now = {
      name: "Poll all channels now",
      options: [],
      callback: async () => this.pollAllChannels(),
    }

    this.setActionDefinitions(definitions)
  }

  // ─── State persistence ──────────────────────────────────────────────────────

  persistState() {
    this.config.presets                  = this.presets
    this.config.offsets                  = this.offsets
    this.config.selected_channel_state   = this.selectedChannel
    this.saveConfig(this.config)
  }

  // ─── Polling ────────────────────────────────────────────────────────────────

  getPollInterval() {
    const configured = Number(this.config.poll_interval)
    return Number.isFinite(configured) ? Math.min(3600000, Math.max(250, Math.round(configured))) : 10000
  }

  startPolling() {
    this.stopPolling()
    this.pollAllChannels()
    this.pollTimer = setInterval(() => this.pollAllChannels(), this.getPollInterval())
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async pollAllChannels() {
    if (this.polling) return
    this.polling = true
    try {
      const results  = await Promise.allSettled([0,1,2,3,4].map((fs) => this.pollChannel(fs)))
      const failures = results.filter((r) => r.status === "rejected")
      if      (failures.length === 0)           this.updateStatus(InstanceStatus.Ok)
      else if (failures.length === NUM_CHANNELS) this.updateStatus(InstanceStatus.ConnectionFailure, failures[0].reason?.message || "Polling failed")
      else                                       this.updateStatus(InstanceStatus.UnknownWarning, `${failures.length} of ${NUM_CHANNELS} channels failed to poll`)
    } finally {
      this.polling = false
    }
  }

  async pollChannel(fs) {
    const data    = await this.sendGet(fs)
    const channel = fs + 1
    const updates = {}
    for (const [id, [jsonField, scale]] of Object.entries(POLL_FIELDS)) {
      const raw = data[jsonField]
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue
      const action = ACTIONS.find((item) => item[0] === id)
      if (!action) continue
      const value = this.clampInteger(raw * scale, action[3], action[4], `${action[1]} polled value`)
      const key   = this.valueKey(id, channel)
      this.values[key] = value
      updates[key]     = value
      if (channel === this.selectedChannel) updates[`selected_${id}`] = value
    }
    if (Object.keys(updates).length > 0) this.setVariableValues(updates)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async resolveChannel(action, context, name) {
    const resolved = await context.parseVariablesInString(String(action.options.channel ?? "1"))
    return this.clampInteger(resolved, 1, NUM_CHANNELS, `${name} channel`)
  }

  async resolvePreset(action, context) {
    const resolved = await context.parseVariablesInString(String(action.options.preset ?? "1"))
    return this.clampInteger(resolved, 1, NUM_PRESETS, "Preset number")
  }

  async adjustAndSend(id, command, name, min, max, channel, direction, amount) {
    const key     = this.valueKey(id, channel)
    const current = Number.isFinite(this.values[key]) ? this.values[key] : 0
    const value   = this.clampInteger(current + direction * amount, min, max, `${name} value`)
    await this.sendAndStore(id, command, name, value, channel)
  }

  async applyColorTemp(step, channel) {
    const redKey      = this.valueKey("white_level_red",  channel)
    const blueKey     = this.valueKey("white_level_blue", channel)
    const redCurrent  = Number.isFinite(this.values[redKey])  ? this.values[redKey]  : 1000
    const blueCurrent = Number.isFinite(this.values[blueKey]) ? this.values[blueKey] : 1000
    const redOffset   = step
    const blueOffset  = -Math.round(step * (1 + Math.abs(step) / 100))
    const redValue    = this.clampInteger(redCurrent  + redOffset,  0, 2000, "White Level Red")
    const blueValue   = this.clampInteger(blueCurrent + blueOffset, 0, 2000, "White Level Blue")
    await this.sendAndStoreMulti([
      ["white_level_red",  "cc%3Awlvlr", "White Level Red",  redValue ],
      ["white_level_blue", "cc%3Awlvlb", "White Level Blue", blueValue],
    ], channel)
    this.log("info", `ColourTemp step=${step} ch${channel}: R=${redValue} B=${blueValue}`)
  }

  // Gamma Master — adjusts Red, Green and Blue gamma channels simultaneously
  // mode "adjust": adds step to current values (relative)
  // mode "set": sets all three channels to the given value (absolute)
  async applyGammaMaster(step, channel, mode = "adjust") {
    const redKey   = this.valueKey("gamma_level_red",   channel)
    const greenKey = this.valueKey("gamma_level_green", channel)
    const blueKey  = this.valueKey("gamma_level_blue",  channel)
    const action   = ACTIONS.find(([id]) => id === "gamma_level_red")
    const [, , , min, max] = action

    let redValue, greenValue, blueValue
    if (mode === "set") {
      // Absolute — set all three to the same value
      redValue   = this.clampInteger(step, min, max, "Gamma Master Red")
      greenValue = this.clampInteger(step, min, max, "Gamma Master Green")
      blueValue  = this.clampInteger(step, min, max, "Gamma Master Blue")
    } else {
      // Relative — add step to each current value independently (preserves offsets between channels)
      const redCurrent   = Number.isFinite(this.values[redKey])   ? this.values[redKey]   : 1000
      const greenCurrent = Number.isFinite(this.values[greenKey]) ? this.values[greenKey] : 1000
      const blueCurrent  = Number.isFinite(this.values[blueKey])  ? this.values[blueKey]  : 1000
      redValue   = this.clampInteger(redCurrent   + step, min, max, "Gamma Master Red")
      greenValue = this.clampInteger(greenCurrent + step, min, max, "Gamma Master Green")
      blueValue  = this.clampInteger(blueCurrent  + step, min, max, "Gamma Master Blue")
    }

    await this.sendAndStoreMulti([
      ["gamma_level_red",   "cc%3Aglvlr", "Gamma Level Red",   redValue  ],
      ["gamma_level_green", "cc%3Aglvlg", "Gamma Level Green", greenValue],
      ["gamma_level_blue",  "cc%3Aglvlb", "Gamma Level Blue",  blueValue ],
    ], channel)
    this.log("info", `GammaMaster ${mode} step=${step} ch${channel}: R=${redValue} G=${greenValue} B=${blueValue}`)
  }

  async sendAndStore(id, command, name, value, channel) {
    const body       = Buffer.from(`${command}=${value}`, "ascii")
    await this.sendPost(body, channel - 1)
    const key        = this.valueKey(id, channel)
    this.values[key] = value
    const updates    = { [key]: value }
    if (channel === this.selectedChannel) updates[`selected_${id}`] = value
    this.setVariableValues(updates)
  }

  safeStoredInteger(input, min, max, fallback) {
    const n = Number(input)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }

  clampInteger(input, min, max, label) {
    const numeric = Number(String(input).trim())
    if (!Number.isFinite(numeric)) {
      const message = `${label} must resolve to a number; received "${input}"`
      this.log("error", message)
      throw new Error(message)
    }
    const rounded = Math.round(numeric)
    const clamped = Math.min(max, Math.max(min, rounded))
    if (clamped !== rounded) this.log("warn", `${label} ${rounded} was clamped to ${clamped} (allowed range ${min}-${max})`)
    return clamped
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  requestOptions(method, path, headers = {}) {
    return { host: String(this.config.host || "10.232.2.58").trim(), port: Number(this.config.port || 80),
      method, path, headers: { Connection: "close", ...headers }, agent: false }
  }

  sendGet(fs) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        this.requestOptions("GET", `/video_param.cgi?fs=${fs}`, { Accept: "application/json" }),
        (res) => {
          const chunks = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end",  () => {
            const body = Buffer.concat(chunks).toString("utf8")
            if (!(res.statusCode >= 200 && res.statusCode < 400))
              return reject(new Error(`FORA GET channel ${fs + 1} returned HTTP ${res.statusCode}: ${body}`))
            try { resolve(JSON.parse(body)) }
            catch (error) { reject(new Error(`Invalid JSON from FORA channel ${fs + 1}: ${error.message}`)) }
          })
        }
      )
      req.setTimeout(3000, () => req.destroy(new Error(`FORA GET channel ${fs + 1} timed out`)))
      req.on("error", (error) => { this.log("warn", `FORA GET channel ${fs + 1} failed: ${error.message}`); reject(error) })
      req.end()
    })
  }

  sendPost(body, fs) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        this.requestOptions("POST", `/post_video.cgi?fs=${fs}`, { "Content-Type": "text/plain", "Content-Length": body.length }),
        (res) => {
          const chunks = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end",  () => {
            const responseBody = Buffer.concat(chunks).toString("utf8")
            if (res.statusCode >= 200 && res.statusCode < 400) { this.updateStatus(InstanceStatus.Ok); resolve() }
            else {
              const message = `FORA returned HTTP ${res.statusCode}: ${responseBody}`
              this.updateStatus(InstanceStatus.ConnectionFailure, message)
              reject(new Error(message))
            }
          })
        }
      )
      req.setTimeout(3000, () => req.destroy(new Error("HTTP request timed out")))
      req.on("error", (error) => {
        this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
        this.log("error", `FORA POST failed: ${error.message}`)
        reject(error)
      })
      req.end(body)
    })
  }

  // Send multiple parameters in a single POST body (e.g. "cc%3Aglvlr=1005&cc%3Aglvlg=1005")
  // Matches the gang POST format used by the device web UI
  async sendMultiPost(params, fs) {
    // params: array of [command, value] pairs
    const bodyStr = params.map(([command, value]) => `${command}=${value}`).join("&")
    const body    = Buffer.from(bodyStr, "ascii")
    await this.sendPost(body, fs)
    this.log("debug", `MultiPost fs=${fs}: ${bodyStr}`)
  }

  // Send multiple parameters and update internal state
  async sendAndStoreMulti(items, channel) {
    // items: array of [id, command, name, value]
    const params = items.map(([, command, , value]) => [command, value])
    await this.sendMultiPost(params, channel - 1)
    const updates = {}
    for (const [id, , , value] of items) {
      const key        = this.valueKey(id, channel)
      this.values[key] = value
      updates[key]     = value
      if (channel === this.selectedChannel) updates[`selected_${id}`] = value
    }
    this.setVariableValues(updates)
  }
}

runEntrypoint(Fora1010Instance, [])