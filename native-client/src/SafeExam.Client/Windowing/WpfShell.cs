using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using SafeExam.Client.Monitoring;

namespace SafeExam.Client.Windowing;

/// WPF Window -> IWindow adapter (KioskWindowManager/ExitInterceptor isi par chalte hain).
public sealed class WpfWindowAdapter : IWindow
{
    private readonly Window _w;
    public event EventHandler? Activated;
    public event EventHandler? Deactivated;
    public event EventHandler<CancelEventArgs>? Closing;

    public WpfWindowAdapter(Window w)
    {
        _w = w;
        w.Activated += (s, e) => Activated?.Invoke(this, e);
        w.Deactivated += (s, e) => Deactivated?.Invoke(this, e);
        w.Closing += (s, e) => Closing?.Invoke(this, e);
    }

    public bool IsBorderless
    {
        get => _w.WindowStyle == WindowStyle.None;
        set => _w.WindowStyle = value ? WindowStyle.None : WindowStyle.SingleBorderWindow;
    }
    public bool IsMaximized
    {
        get => _w.WindowState == WindowState.Maximized;
        set
        {
            if (value) { _w.Left = 0; _w.Top = 0; }          // primary monitor (origin 0,0)
            _w.WindowState = value ? WindowState.Maximized : WindowState.Normal;
        }
    }
    public bool IsResizable
    {
        get => _w.ResizeMode != ResizeMode.NoResize;
        set => _w.ResizeMode = value ? ResizeMode.CanResize : ResizeMode.NoResize;
    }
    public bool IsTopmost { get => _w.Topmost; set => _w.Topmost = value; }
    public bool ShowInTaskbar { get => _w.ShowInTaskbar; set => _w.ShowInTaskbar = value; }
    public void Activate() => _w.Activate();
    public void Close() => _w.Close();
    public void Post(Action action) => _w.Dispatcher.BeginInvoke(action);
}

/// Exit-code dialog (code-only WPF window, XAML nahi).
public sealed class WpfExitPrompt : IExitPrompt
{
    private readonly Window _owner;
    public WpfExitPrompt(Window owner) { _owner = owner; }

    public string? AskCode(bool codeRequired)
    {
        if (!codeRequired)
        {
            var r = MessageBox.Show(_owner, "Exit the exam application?", "SafeExam", MessageBoxButton.YesNo, MessageBoxImage.Question);
            return r == MessageBoxResult.Yes ? "" : null;
        }
        string? result = null;
        var box = new PasswordBox { Margin = new Thickness(0, 8, 0, 12) };
        var ok = new Button { Content = "Exit", Width = 80, IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
        var cancel = new Button { Content = "Cancel", Width = 80, IsCancel = true };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(ok); buttons.Children.Add(cancel);
        var panel = new StackPanel { Margin = new Thickness(16) };
        panel.Children.Add(new TextBlock { Text = "Enter the exit code given by your invigilator:" });
        panel.Children.Add(box); panel.Children.Add(buttons);
        var dlg = new Window
        {
            Title = "Exit exam", Content = panel, Width = 380, SizeToContent = SizeToContent.Height,
            ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = _owner, Topmost = true, ShowInTaskbar = false,
        };
        ok.Click += (_, _) => { result = box.Password; dlg.DialogResult = true; };
        dlg.Loaded += (_, _) => box.Focus();
        dlg.ShowDialog();
        return result;
    }
}

/// HwndSource hook: WM_CLIPBOARDUPDATE, WM_HOTKEY (PrintScreen), WM_DISPLAYCHANGE.
/// Sirf documented messages/APIs — low-level keyboard hook nahi (R4).
public sealed class WpfMessageHook : IClipboardChangeSource, IHotkeyRegistrar, IDisposable
{
    private readonly IntPtr _hwnd;
    private readonly HwndSource? _source;
    private readonly Win32DisplayProvider _display;
    private readonly Dictionary<int, Action> _hotkeys = new();
    private int _nextId = 0x5E00;
    private bool _listening;

    public event EventHandler? Changed;     // clipboard changed

    public WpfMessageHook(Window window, Win32DisplayProvider display)
    {
        _display = display;
        _hwnd = new WindowInteropHelper(window).EnsureHandle();
        _source = HwndSource.FromHwnd(_hwnd);
        _source?.AddHook(WndProc);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (msg)
        {
            case NativeMethods.WM_CLIPBOARDUPDATE: Changed?.Invoke(this, EventArgs.Empty); break;
            case NativeMethods.WM_DISPLAYCHANGE: _display.NotifyChanged(); break;
            case NativeMethods.WM_HOTKEY:
                if (_hotkeys.TryGetValue(wParam.ToInt32(), out var cb)) { cb(); handled = true; }
                break;
        }
        return IntPtr.Zero;
    }

    void IClipboardChangeSource.Start() { if (!_listening) _listening = NativeMethods.AddClipboardFormatListener(_hwnd); }
    void IClipboardChangeSource.Stop() { if (_listening) { NativeMethods.RemoveClipboardFormatListener(_hwnd); _listening = false; } }

    public bool TryRegister(int virtualKey, Action onPressed)
    {
        var id = _nextId++;
        if (!NativeMethods.RegisterHotKey(_hwnd, id, 0, (uint)virtualKey)) return false;   // fail => skip
        _hotkeys[id] = onPressed;
        return true;
    }

    public void UnregisterAll()
    {
        foreach (var id in _hotkeys.Keys) NativeMethods.UnregisterHotKey(_hwnd, id);
        _hotkeys.Clear();
    }

    public void Dispose()
    {
        UnregisterAll();
        ((IClipboardChangeSource)this).Stop();
        _source?.RemoveHook(WndProc);
    }
}

/// System.Windows.Clipboard.Clear() sirf. Content kabhi read nahi hota (R7).
public sealed class WpfClipboard : IClipboard
{
    public void Clear() => Clipboard.Clear();     // UI (STA) thread par
}
