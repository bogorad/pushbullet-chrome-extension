/**
 * Pushbullet End-to-End Encryption (E2EE) Decryption
 * 
 * Based on Pushbullet's E2EE specification:
 * - Key derivation: PBKDF2 with HMAC-SHA256
 * - Encryption: AES-256-GCM
 * - Encoding: Base64
 */

import type { Push } from '../../types/domain';

export class PushbulletCrypto {
  /**
   * Generate encryption/decryption key from password
   * @param password - User's encryption password
   * @param userIden - User's iden (used as salt)
   * @returns Derived key for AES-GCM
   */
  static async deriveKey(password: string, userIden: string): Promise<CryptoKey> {
    // Check if Web Crypto API is available
    if (!globalThis.crypto || !crypto.subtle) {
      throw new Error('Web Crypto API unavailable - requires HTTPS or localhost');
    }

    // Convert password to bytes
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    
    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // Use user iden as salt
    const salt = encoder.encode(userIden);
    
    // Derive key using PBKDF2
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 30000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    return key;
  }
  
  /**
   * Decrypt an encrypted message
   * @param encodedMessage - Base64 encoded encrypted message
   * @param key - Decryption key
   * @returns Decrypted message object
   */
  static async decryptMessage(encodedMessage: string, key: CryptoKey): Promise<unknown> {
    try {
      // Decode from base64
      const encryptedData = this.base64ToBytes(encodedMessage);
      
      // Parse the encoded message format:
      // version (1 byte) + tag (16 bytes) + iv (12 bytes) + ciphertext (rest)
      const version = encryptedData[0];
      
      if (version !== 49) { // ASCII '1'
        throw new Error(`Unsupported encryption version: ${version}`);
      }
      
      const tag = encryptedData.slice(1, 17);        // 16 bytes
      const iv = encryptedData.slice(17, 29);        // 12 bytes (96 bits)
      const ciphertext = encryptedData.slice(29);    // Rest
      
      // Combine ciphertext and tag for AES-GCM
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      
      // Decrypt using AES-GCM
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          tagLength: 128 // 16 bytes = 128 bits
        },
        key,
        combined
      );
      
      // Convert decrypted bytes to string
      const decoder = new TextDecoder();
      const decryptedText = decoder.decode(decrypted);
      
      // Parse as JSON
      return JSON.parse(decryptedText);
    } catch (error) {
      // SECURITY FIX (M-04): Don't log sensitive crypto data
      console.error('Decryption error - check encryption password');
      throw new Error('Failed to decrypt message. Check your encryption password.');
    }
  }
  
  /**
   * Convert base64 string to Uint8Array
   * @param base64 - Base64 encoded string
   * @returns Decoded bytes
   */
  static base64ToBytes(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  /**
   * Decrypt a Pushbullet encrypted push
   * @param encryptedPush - Push object with 'encrypted' and 'ciphertext' fields
   * @param password - User's encryption password
   * @param userIden - User's iden
   * @returns Decrypted push data
   */
  static async decryptPush(encryptedPush: Push, password: string, userIden: string): Promise<Push> {
    if (!encryptedPush.encrypted || !encryptedPush.ciphertext) {
      throw new Error('Push is not encrypted');
    }
    
    // Derive key from password
    const key = await this.deriveKey(password, userIden);
    
    // Decrypt the ciphertext
    const decryptedData = await this.decryptMessage(encryptedPush.ciphertext, key);
    
    // Return decrypted push with original metadata
    return {
      ...encryptedPush,
      ...(decryptedData as object),
      encrypted: false // Mark as decrypted
    } as Push;
  }
}

