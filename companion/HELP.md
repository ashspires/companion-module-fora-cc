# FOR-A CC Companion Module

## Connection

Enter the IP address or hostname of the FOR-A 1010. The default HTTP port is 80.

The module polls all five channels using `/video_param.cgi?fs=0` through `fs=4` and sends commands to `/post_video.cgi?fs=n`.

## Channel mapping

- Companion channel 1 → `fs=0`
- Companion channel 2 → `fs=1`
- Companion channel 3 → `fs=2`
- Companion channel 4 → `fs=3`
- Companion channel 5 → `fs=4`

## Features

- Set any processing attribute with one variable-aware action
- Increase or decrease any attribute with one variable-aware adjustment action
- Polling and per-channel variables
- Currently selected channel variables
- Store and recall presets for all parameters
- Variable-enabled values, channels and preset numbers
