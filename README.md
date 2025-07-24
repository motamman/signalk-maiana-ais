# SignalK MAIANA AIS Plugin

A SignalK plugin for interfacing with the MAIANA AIS Transponder.

## Overview

This plugin enables SignalK to communicate with MAIANA AIS transponders, allowing you to:

- Receive AIS messages from other vessels
- Transmit your own vessel's AIS information
- Monitor transponder status and health
- Configure transponder settings

## Installation

```bash
npm install signalk-maiana-ais
```

## Configuration

Configure the plugin through the SignalK server admin interface:

- **Serial Port**: Path to the MAIANA device (e.g., `/dev/ttyUSB0`)
- **Baud Rate**: Communication speed (default: 38400)
- **Own MMSI**: Your vessel's MMSI number for transmission
- **Enable Transmission**: Whether to transmit AIS messages

## Hardware

This plugin is designed to work with the MAIANA AIS Transponder hardware project by Peter Antypas. See the [original MAIANA project](https://github.com/peterantypas/maiana) for hardware documentation.

## License

GPL-3.0 - This project is adapted from the MAIANA project and maintains the same license.

## Attribution

Adapted from the MAIANA AIS Transponder project by Peter Antypas.
Original work: https://github.com/peterantypas/maiana