using System.Diagnostics;
using System.Runtime.InteropServices;

namespace SafeExam.Client.Monitoring;

/// Sirf documented, normal-privilege Win32 calls (R4: koi low-level keyboard hook / driver trick nahi).
internal static class NativeMethods
{
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("kernel32.dll")] internal static extern bool AttachConsole(int dwProcessId);

    internal const int SM_CXSCREEN = 0, SM_CYSCREEN = 1, SM_CMONITORS = 80;
    internal const int WM_CLIPBOARDUPDATE = 0x031D, WM_HOTKEY = 0x0312, WM_DISPLAYCHANGE = 0x007E;
}

public sealed class Win32ForegroundProvider : IForegroundProvider
{
    public string? GetForegroundProcessName()
    {
        var hwnd = NativeMethods.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;                       // secure desktop / UAC
        NativeMethods.GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) return null;
        try { using var p = Process.GetProcessById((int)pid); return p.ProcessName; }   // title kabhi nahi padhte
        catch { return null; }
    }
}

public sealed class Win32DisplayProvider : IDisplayProvider
{
    public event EventHandler? Changed;
    /// WPF window hook (WM_DISPLAYCHANGE) isko call karta hai.
    public void NotifyChanged() => Changed?.Invoke(this, EventArgs.Empty);

    public DisplayInfo GetInfo() => new(
        Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SM_CMONITORS)),
        NativeMethods.GetSystemMetrics(NativeMethods.SM_CXSCREEN),
        NativeMethods.GetSystemMetrics(NativeMethods.SM_CYSCREEN));
}
