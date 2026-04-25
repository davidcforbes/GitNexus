/**
 * Regression tests for GitNexus-a4r — `/api/analyze` path validation.
 *
 * The previous guard relied on `path.isAbsolute(p) && path.normalize(p) ===
 * path.resolve(p)` which on Windows returns true for UNC shares
 * (`\\server\share\...`) and DOS device namespace paths (`\\?\...`,
 * `\\.\PIPE\...`), letting an attacker who can reach the LAN-accessible
 * `/api/analyze` endpoint trigger an indexing job against a network share
 * or a named pipe.
 *
 * We test the helper `isWindowsUncOrDevicePath` directly so the suite is
 * platform-agnostic — the real production code only consults the helper
 * when `process.platform === 'win32'`.
 */
import { describe, it, expect } from 'vitest';
import { isWindowsUncOrDevicePath } from '../../src/server/api.js';

describe('isWindowsUncOrDevicePath (GitNexus-a4r)', () => {
  describe('rejects DOS device namespace prefixes', () => {
    it('\\\\?\\C:\\foo', () => {
      expect(isWindowsUncOrDevicePath('\\\\?\\C:\\foo')).toBe(true);
    });

    it('\\\\?\\Volume{...}\\repo', () => {
      expect(isWindowsUncOrDevicePath('\\\\?\\Volume{12345}\\repo')).toBe(true);
    });

    it('\\\\.\\PIPE\\foo', () => {
      expect(isWindowsUncOrDevicePath('\\\\.\\PIPE\\foo')).toBe(true);
    });

    it('\\\\.\\PhysicalDrive0', () => {
      expect(isWindowsUncOrDevicePath('\\\\.\\PhysicalDrive0')).toBe(true);
    });
  });

  describe('rejects UNC server-share paths', () => {
    it('\\\\server\\share\\repo', () => {
      expect(isWindowsUncOrDevicePath('\\\\server\\share\\repo')).toBe(true);
    });

    it('\\\\10.0.0.1\\public', () => {
      expect(isWindowsUncOrDevicePath('\\\\10.0.0.1\\public')).toBe(true);
    });
  });

  describe('rejects forward-slash variants of UNC + device paths', () => {
    it('//?/C:/foo', () => {
      expect(isWindowsUncOrDevicePath('//?/C:/foo')).toBe(true);
    });

    it('//./PIPE/foo', () => {
      expect(isWindowsUncOrDevicePath('//./PIPE/foo')).toBe(true);
    });

    it('//server/share/repo', () => {
      expect(isWindowsUncOrDevicePath('//server/share/repo')).toBe(true);
    });
  });

  describe('passes ordinary absolute paths', () => {
    it('C:\\Users\\me\\repo', () => {
      expect(isWindowsUncOrDevicePath('C:\\Users\\me\\repo')).toBe(false);
    });

    it('C:/Users/me/repo (forward-slash drive form)', () => {
      expect(isWindowsUncOrDevicePath('C:/Users/me/repo')).toBe(false);
    });

    it('D:\\projects\\thing', () => {
      expect(isWindowsUncOrDevicePath('D:\\projects\\thing')).toBe(false);
    });

    it('/home/user/repo (POSIX absolute)', () => {
      expect(isWindowsUncOrDevicePath('/home/user/repo')).toBe(false);
    });

    it('relative path stays false (not our job to flag — caller already rejects)', () => {
      expect(isWindowsUncOrDevicePath('foo/bar')).toBe(false);
      expect(isWindowsUncOrDevicePath('./foo')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('empty string is not flagged (guard handles "" elsewhere)', () => {
      expect(isWindowsUncOrDevicePath('')).toBe(false);
    });

    it('single backslash is not UNC', () => {
      expect(isWindowsUncOrDevicePath('\\')).toBe(false);
    });

    it('single forward slash is not UNC', () => {
      expect(isWindowsUncOrDevicePath('/')).toBe(false);
    });
  });
});
