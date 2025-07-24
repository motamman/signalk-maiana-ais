# SignalK MAIANA AIS Controller Plugin

A SignalK plugin for controlling MAIANA AIS Transponder configuration and transmission.

## Overview

This plugin provides **device control** for MAIANA AIS transponders. For **data ingestion**, use SignalK's built-in NMEA0183 data connections which handle AIS parsing automatically.

### What This Plugin Does:
- **Device Configuration**: Automatically configure MAIANA with vessel data from SignalK settings
- **Transmission Control**: Enable/disable AIS transmission via UI or PUT requests  
- **Command Interface**: Send configuration commands using proper MAIANA syntax
- **Status Monitoring**: Track device connection and transmission status

### What SignalK Data Connections Handle:
- **AIS Data Parsing**: `!AIVDM`/`!AIVDO` sentences → SignalK deltas
- **Serial Port Management**: Connection, reconnection, NMEA streaming
- **Source Attribution**: Proper delta formatting with correct source fields

## Setup

### 1. Install the Plugin

```bash
npm install motamman/signalk-maiana-ais
```

### 2. Create NMEA0183 Data Connection

In SignalK Admin UI:
1. Go to **Server → Data Connections**
2. Add **NMEA0183** connection:
   - **ID**: `maiana-ais`
   - **Type**: `Serial`
   - **Device**: `/dev/ttyUSB0` (your MAIANA device path)
   - **Baud Rate**: `38400`
3. Enable and restart the connection

### 3. Configure the Plugin

In SignalK Admin UI → **Server → Plugin Config → MAIANA AIS Controller**:

#### Required Settings
- **Serial Device Path**: Same path as your data connection (e.g., `/dev/ttyUSB0`)

#### Optional Settings  
- **Baud Rate**: Communication speed (default: 38400)
- **Port Offset**: Distance from GPS antenna to port side in meters (default: 0)
- **Bow Offset**: Distance from GPS antenna to bow in meters (default: 0)
- **Enable Transmission**: Allow the transponder to transmit AIS messages (default: false)
- **Enable PUT Control**: Allow external control of transmission via PUT requests (default: false)
- **Transmit Control Path**: SignalK path for transmission control (default: `communication.ais.transmit.state`)
- **Debug Mode**: Enable debug logging (default: false)

> **Note**: The plugin uses the same serial port as your data connection for sending commands. Both can safely share the same port.

## Vessel Data Integration

The plugin automatically uses vessel data from SignalK system settings instead of requiring duplicate configuration:

- **MMSI**: From `vessels.self.mmsi`
- **Vessel Name**: From `vessels.self.name`
- **Call Sign**: From `vessels.self.communication.callsignRadio`
- **Length**: From `vessels.self.design.length.overall`
- **Beam**: From `vessels.self.design.beam`
- **Ship Type**: From `vessels.self.aishub.shipType` (limited to MAIANA-supported values: 30, 34, 36, 37)

## API Endpoints

When the plugin is running, it provides these HTTP endpoints:

- **POST** `/plugins/maiana-ais/reconfigure` - Reconfigure MAIANA with current vessel data
- **GET** `/plugins/maiana-ais/vessel-data` - View current vessel data being used

## PUT Control

When **Enable PUT Control** is enabled, transmission can be controlled externally:

```bash
# Enable transmission
curl -X PUT http://signalk-server/signalk/v1/api/vessels/self/communication/ais/transmit/state \
  -H "Content-Type: application/json" \
  -d "true"

# Disable transmission
curl -X PUT http://signalk-server/signalk/v1/api/vessels/self/communication/ais/transmit/state \
  -H "Content-Type: application/json" \
  -d "false"
```

PUT changes are automatically synced back to the plugin configuration checkbox.

## Architecture

```
MAIANA Device
     ↓ (serial bidirectional)
     ├── SignalK Data Connection → AIS parsing → SignalK deltas  
     └── MAIANA Controller Plugin → Device commands → MAIANA Device
```

**Data Flow:**
- **Incoming AIS**: MAIANA → Data Connection → SignalK deltas
- **Device Control**: Plugin → MAIANA configuration commands
- **Transmission Control**: Plugin → `tx on`/`tx off` commands

**Benefits:**
- **Reliable AIS Parsing**: Uses SignalK's proven NMEA0183 parser
- **Proper Source Attribution**: Built-in parser handles delta formatting correctly  
- **Focused Plugin**: Only handles device control, not data parsing
- **Standard Compliance**: AIS data follows SignalK conventions

## Hardware

This plugin is designed to work with the MAIANA AIS Transponder hardware project by Peter Antypas. See the [original MAIANA project](https://github.com/peterantypas/maiana) for hardware documentation.

## License

GPL-3.0 - This project is adapted from the MAIANA project and maintains the same license.

## Attribution

Adapted from the MAIANA AIS Transponder project by Peter Antypas.
Original work: https://github.com/peterantypas/maiana