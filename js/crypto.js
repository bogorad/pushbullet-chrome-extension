'use strict';

/**
 * Pushbullet End-to-End Encryption (E2EE) Decryption
 * 
 * Based on Pushbullet's E2EE specification:
 * - Key derivation: PBKDF2 with HMAC-SHA256
 * - Encryption: AES-256-GCM
 * - Encoding: Base64
 */

class PushbulletCrypto {
  /**
   * Generate encryption/decryption key from password
   * @param {string} password - User's encryption password
   * @param {string} userIden - User's iden (used as salt)
   * @returns {Promise<CryptoKey>} - Derived key for AES-GCM
   */
  static async deriveKey(password, userIden) {
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
   * @param {string} encodedMessage - Base64 encoded encrypted message
   * @param {CryptoKey} key - Decryption key
   * @returns {Promise<object>} - Decrypted message object
   */
  static async decryptMessage(encodedMessage, key) {
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
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt message. Check your encryption password.');
    }
  }
  
  /**
   * Convert base64 string to Uint8Array
   * @param {string} base64 - Base64 encoded string
   * @returns {Uint8Array} - Decoded bytes
   */
  static base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  /**
   * Decrypt a Pushbullet encrypted push
   * @param {object} encryptedPush - Push object with 'encrypted' and 'ciphertext' fields
   * @param {string} password - User's encryption password
   * @param {string} userIden - User's iden
   * @returns {Promise<object>} - Decrypted push data
   */
  static async decryptPush(encryptedPush, password, userIden) {
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
      ...decryptedData,
      encrypted: false, // Mark as decrypted
      _wasEncrypted: true // Flag to indicate it was encrypted
    };
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PushbulletCrypto;
}

