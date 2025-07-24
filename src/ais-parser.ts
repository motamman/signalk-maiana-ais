/*
 * AIS Message Parser
 * 
 * Adapted from the MAIANA AIS Transponder project by Peter Antypas
 * Original work: https://github.com/peterantypas/maiana
 * Copyright (C) Peter Antypas
 * 
 * SignalK plugin adaptation:
 * Copyright (C) 2024 Maurice Tamman
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import * as nmea from 'nmea-simple';
import type { AISMessage, SignalKDelta } from './types';

export class AISParser {
  private ownMMSI?: number;

  constructor(ownMMSI?: number) {
    this.ownMMSI = ownMMSI;
  }

  parseAISMessage(nmeaSentence: string): AISMessage | null {
    try {
      const parsed = nmea.parseNmeaSentence(nmeaSentence);
      
      // Check if this is an AIS VDM or VDO message
      const sentence = parsed as any; // nmea-simple doesn't have proper types
      if (!sentence.payload) {
        return null;
      }

      // Extract AIS data from the parsed NMEA sentence
      const aisData = this.decodeAISData(parsed);
      if (!aisData) return null;

      if (!aisData.mmsi || !aisData.messageType) {
        return null;
      }

      return {
        mmsi: aisData.mmsi,
        messageType: aisData.messageType,
        timestamp: new Date(),
        ...aisData
      };
    } catch (error) {
      console.error('AIS Parse Error:', error);
      return null;
    }
  }

  private decodeAISData(parsed: any): Partial<AISMessage> | null {
    // This is a simplified AIS decoder
    // In a full implementation, you'd need to decode the 6-bit ASCII payload
    // For now, we'll extract what we can from the nmea-simple library
    
    if (!parsed.payload) return null;

    try {
      // Basic message type extraction (first 6 bits)
      const messageType = this.extractBits(parsed.payload, 0, 6);
      
      // MMSI extraction (bits 8-37)  
      const mmsi = this.extractBits(parsed.payload, 8, 30);

      const result: Partial<AISMessage> = {
        messageType,
        mmsi
      };

      // Decode based on message type
      switch (messageType) {
        case 1:
        case 2:
        case 3:
          // Position Report Class A
          this.decodePositionReport(parsed.payload, result);
          break;
        case 4:
        case 11:
          // Base Station Report / UTC Date Response
          this.decodeBaseStationReport(parsed.payload, result);
          break;
        case 5:
          // Static and Voyage Related Data
          this.decodeStaticData(parsed.payload, result);
          break;
        case 18:
          // Standard Class B CS Position Report
          this.decodeClassBPosition(parsed.payload, result);
          break;
        case 19:
          // Extended Class B CS Position Report
          this.decodeExtendedClassBPosition(parsed.payload, result);
          break;
        case 24:
          // Static Data Report
          this.decodeStaticDataReport(parsed.payload, result);
          break;
      }

      return result;
    } catch (error) {
      console.error('AIS Decode Error:', error);
      return null;
    }
  }

  private decodePositionReport(payload: string, result: Partial<AISMessage>): void {
    // Navigation status (bits 38-41)
    result.navigationStatus = this.extractBits(payload, 38, 4);
    
    // Rate of turn (bits 42-49)
    const rot = this.extractSignedBits(payload, 42, 8);
    result.rateOfTurn = rot === 128 ? undefined : rot * 4.733;
    
    // Speed over ground (bits 50-59)
    const sog = this.extractBits(payload, 50, 10);
    result.speedOverGround = sog === 1023 ? undefined : sog / 10;
    
    // Position accuracy (bit 60)
    // const accuracy = this.extractBits(payload, 60, 1);
    
    // Longitude (bits 61-88)
    const lon = this.extractSignedBits(payload, 61, 28);
    result.longitude = lon === 0x6791AC0 ? undefined : lon / 600000;
    
    // Latitude (bits 89-115)
    const lat = this.extractSignedBits(payload, 89, 27);  
    result.latitude = lat === 0x3412140 ? undefined : lat / 600000;
    
    // Course over ground (bits 116-127)
    const cog = this.extractBits(payload, 116, 12);
    result.courseOverGround = cog === 3600 ? undefined : cog / 10;
    
    // True heading (bits 128-136)
    const heading = this.extractBits(payload, 128, 9);
    result.trueHeading = heading === 511 ? undefined : heading;
  }

  private decodeBaseStationReport(_payload: string, _result: Partial<AISMessage>): void {
    // Implement base station report decoding
  }

  private decodeStaticData(payload: string, result: Partial<AISMessage>): void {
    // Vessel name (bits 112-231, 20 6-bit characters)
    result.shipName = this.extractString(payload, 112, 120).trim();
    
    // Ship and cargo type (bits 232-239)
    result.shipType = this.extractBits(payload, 232, 8);
    
    // Dimensions (bits 240-269)
    result.dimensions = {
      to_bow: this.extractBits(payload, 240, 9),
      to_stern: this.extractBits(payload, 249, 9),
      to_port: this.extractBits(payload, 258, 6),
      to_starboard: this.extractBits(payload, 264, 6)
    };
    
    // Call sign (bits 70-111, 7 6-bit characters)
    result.callsign = this.extractString(payload, 70, 42).trim();
  }

  private decodeClassBPosition(payload: string, result: Partial<AISMessage>): void {
    // Similar to Class A but with some differences
    this.decodePositionReport(payload, result);
  }

  private decodeExtendedClassBPosition(payload: string, result: Partial<AISMessage>): void {
    // Extended Class B position report
    this.decodePositionReport(payload, result);
  }

  private decodeStaticDataReport(_payload: string, _result: Partial<AISMessage>): void {
    // Implement static data report decoding
  }

  private extractBits(payload: string, start: number, length: number): number {
    // Convert 6-bit ASCII to binary and extract bits
    let binary = '';
    for (const char of payload) {
      const code = char.charCodeAt(0);
      const value = code < 87 ? code - 48 : code - 87;
      binary += value.toString(2).padStart(6, '0');
    }
    
    const bits = binary.slice(start, start + length);
    return parseInt(bits, 2);
  }

  private extractSignedBits(payload: string, start: number, length: number): number {
    const value = this.extractBits(payload, start, length);
    const signBit = 1 << (length - 1);
    
    if (value & signBit) {
      // Negative number in two's complement
      return value - (1 << length);
    }
    return value;
  }

  private extractString(payload: string, start: number, length: number): string {
    let result = '';
    for (let i = 0; i < length; i += 6) {
      const bits = this.extractBits(payload, start + i, 6);
      if (bits === 0) break; // Null terminator
      
      // Convert 6-bit value to ASCII
      const char = bits < 32 ? String.fromCharCode(bits + 64) : String.fromCharCode(bits);
      result += char;
    }
    return result;
  }

  createSignalKDelta(aisMessage: AISMessage): SignalKDelta {
    const context = aisMessage.mmsi === this.ownMMSI ? 
      'vessels.self' : 
      `vessels.urn:mrn:imo:mmsi:${aisMessage.mmsi}`;

    const values: Array<{ path: string; value: any }> = [];

    if (aisMessage.latitude !== undefined && aisMessage.longitude !== undefined) {
      values.push({
        path: 'navigation.position',
        value: {
          latitude: aisMessage.latitude,
          longitude: aisMessage.longitude,
          source: 'AIS'
        }
      });
    }

    if (aisMessage.speedOverGround !== undefined) {
      values.push({
        path: 'navigation.speedOverGround',
        value: aisMessage.speedOverGround * 0.514444 // knots to m/s
      });
    }

    if (aisMessage.courseOverGround !== undefined) {
      values.push({
        path: 'navigation.courseOverGroundTrue',
        value: aisMessage.courseOverGround * Math.PI / 180 // degrees to radians
      });
    }

    if (aisMessage.trueHeading !== undefined) {
      values.push({
        path: 'navigation.headingTrue',
        value: aisMessage.trueHeading * Math.PI / 180
      });
    }

    if (aisMessage.shipName) {
      values.push({
        path: 'name',
        value: aisMessage.shipName
      });
    }

    if (aisMessage.callsign) {
      values.push({
        path: 'communication.callsignRadio',
        value: aisMessage.callsign
      });
    }

    return {
      context,
      updates: [{
        source: {
          label: 'MAIANA AIS',
          type: 'NMEA0183'
        },
        timestamp: aisMessage.timestamp.toISOString(),
        values
      }]
    };
  }
}