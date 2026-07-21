# Changelog

## 1.8.0
- Added preset_held, preset_saved variables, preset_stored_{N}_{ch} variables 
- Added set_preset_held action
- Added presetSavedTimer logic in store_preset
- Added toggle actions for CCMode, gammaCurve and bypass

## 1.7.0

- Replaced the separate per-attribute set actions with one variable-aware Set Attribute action.

## 1.6.0

- Replaced the separate per-attribute increment and decrement actions with one configurable Adjust Attribute action.
- Added a variable-aware adjustment amount suitable for Companion global custom variables.
- Removed sensitivity actions, configuration fields, state, and the sensitivity variable.

## 1.5.0

- Added currently selected channel variables.
- Added store and recall preset actions.
- Added continuous polling for all five channels.
- Added per-channel and selected-channel parameter variables.
- Added sensitivity-controlled increment and decrement actions.
