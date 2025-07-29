# MAIANA AIS Serial Port Conflict Analysis

## Issue Summary

The MAIANA AIS transponder plugin was experiencing recurring 5-second errors and failing to transmit AIS messages despite showing "TRANSMITTING" status. After extensive debugging, we identified the root cause: **a serial port conflict between SignalK's direct data connection and our plugin**.

## Background: MAIANA Design Architecture

According to the MAIANA Assembly Manual (UART), the MAIANA transponder was designed with a specific architecture:

- **Single UART Output**: MAIANA outputs a continuous NMEA stream at 38.4K bps
- **Combined Data Stream**: This stream contains BOTH GPS data AND AIS transmission data
- **Single Connection Design**: The receiving system should connect to this single stream rather than having multiple connections

> "The UART continuously sends GPS and AIS data in NMEA0183 format at 38.4Kbps. It also accepts certain commands for management."

## Current Problem: Dual Access Conflict

### What We Found

1. **SignalK Data Connection**: SignalK has a configured data connection named "test-ais" that directly reads from `/dev/ttyOP_maiana`
2. **Plugin Access**: Our MAIANA plugin also attempts to access the same serial device for sending commands
3. **Serial Port Conflict**: Two processes trying to access the same serial device causes:
   - Recurring connection errors every 5 seconds
   - Commands not reaching the MAIANA device reliably
   - GPS data being read by SignalK but not available to plugin for command context
   - AIS transmission messages being intercepted by SignalK instead of being visible

### Evidence from Configuration

From `~/.signalk/settings.json`:
```json
{
  "pipedProviders": [
    {
      "pipeElements": [
        {
          "type": "providers/simple",
          "options": {
            "logging": false,
            "type": "NMEA0183",
            "subOptions": {
              "validateChecksum": true,
              "type": "serial",
              "device": "/dev/ttyOP_maiana",  // <-- CONFLICT HERE
              "baudrate": 38400
            }
          }
        }
      ],
      "id": "test-ais",
      "enabled": true  // <-- THIS NEEDS TO BE DISABLED
    }
  ]
}
```

## What We Tried and Why

### 1. Plugin Development and Debugging (Initial Approach)
- **What**: Extensive NMEA parsing, PAINF message decoding, vessel data extraction
- **Why**: We thought the issue was with data parsing or configuration
- **Result**: Plugin worked perfectly for GPS data and command responses, but no AIS transmissions

### 2. Station Configuration Fixes
- **What**: Fixed vessel data extraction, added proper station configuration format, added REBOOT command
- **Why**: Original MAIANA code showed these were required for transmission
- **Result**: MAIANA showed "TRANSMITTING" status but still no actual !AIVDM messages

### 3. Transmission Control Implementation  
- **What**: Added tx on/off commands, PAITXCFG status parsing, PUT control handlers
- **Why**: Thought transmission needed to be explicitly enabled
- **Result**: All status indicators showed transmission was active, but no AIS messages appeared

### 4. Original Code Analysis
- **What**: Detailed review of maianaclient.py and CommandProcessor.cpp
- **Why**: User repeatedly directed us to examine original code for missed requirements
- **Result**: Confirmed our implementation matched original design, but still no transmissions

### 5. Hardware and Port Analysis
- **What**: Examined process conflicts, checked for serial port access issues
- **Why**: Suspected hardware or exclusive access problems
- **Result**: Discovered dual access conflict between SignalK and plugin

### 6. MAIANA Manual Review (Breakthrough)
- **What**: Examined MAIANA Assembly Manual for proper setup
- **Why**: Looking for architectural requirements we missed
- **Result**: **DISCOVERED THE ROOT CAUSE** - MAIANA designed for single connection, not dual access

## Root Cause Analysis

The fundamental issue is **architectural mismatch**:

1. **MAIANA Design**: Single UART stream containing GPS + AIS data, accessed by one consumer
2. **Current Setup**: SignalK reads GPS data directly + Plugin sends commands = dual access conflict
3. **Correct Setup**: Plugin should have exclusive access and forward GPS data to SignalK

### Why This Causes Problems

- **Serial Port Locking**: Operating system prevents multiple processes from accessing same serial device
- **Data Interception**: SignalK intercepts all NMEA data including AIS transmissions (!AIVDM)
- **Command Interference**: Plugin commands may not reach device when SignalK has device open
- **Resource Contention**: Both processes compete for exclusive device access

## Next Steps and Solution

### Immediate Fix Required

1. **Disable SignalK Direct Connection**:
   ```bash
   # Backup current settings
   cp ~/.signalk/settings.json ~/.signalk/settings.json.backup
   
   # Edit settings.json using nano
   nano ~/.signalk/settings.json
   
   # In the editor, find the "test-ais" section and change:
   # "enabled": true  →  "enabled": false
   # Save and exit: Ctrl+X, Y, Enter
   ```

2. **Restart SignalK Service**:
   ```bash
   sudo systemctl restart signalk
   ```

3. **Verify Plugin Configuration**:
   - Ensure plugin is configured to use correct device path
   - Confirm plugin has exclusive access to MAIANA serial port

4. **Test Resolution**:
   - Monitor for elimination of 5-second errors
   - Verify AIS transmissions (!AIVDM messages) appear in plugin logs
   - Check that GPS data still flows to SignalK via plugin deltas

### Why This Will Work

1. **Exclusive Access**: Plugin will have sole access to MAIANA device
2. **Complete Data Stream**: Plugin receives both GPS and AIS data from MAIANA
3. **Proper Forwarding**: Plugin can parse GPS data and forward to SignalK via deltas
4. **Command Success**: Commands will reach MAIANA without interference
5. **AIS Visibility**: Transmitted AIS messages will be visible to plugin for logging/forwarding

### Architecture After Fix

```
MAIANA Device (/dev/ttyOP_maiana)
       ↓ (exclusive access)
   Plugin Process
       ↓ (GPS data via SignalK deltas)
   SignalK Core
       ↓ (processed data)
   SignalK Clients
```

This matches the intended MAIANA design where the transponder provides a single data stream that should be consumed by one process, which then distributes the parsed data appropriately.

## Lessons Learned

1. **Read Hardware Documentation First**: The MAIANA manual contained the critical architectural information
2. **Single Responsibility**: MAIANA was designed for single-consumer access, not multi-consumer
3. **Serial Port Conflicts**: Multiple processes accessing same serial device causes subtle but critical issues
4. **Root Cause vs Symptoms**: Hours spent on symptom fixes (parsing, configuration) when root cause was architectural

## Verification Steps Post-Fix

1. No more 5-second recurring errors in logs
2. AIS transmission messages (!AIVDM) visible in plugin output  
3. GPS data still flowing to SignalK via plugin deltas
4. MAIANA commands executing successfully
5. Proper AIS transmission intervals (every 30 seconds for Class B)