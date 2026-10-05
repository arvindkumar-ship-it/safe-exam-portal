using System.ComponentModel;

namespace SafeExam.Client.Windowing;

/// WPF Window ka chhota abstraction (tests me fake). Real adapter: WpfShell.cs.
public interface IWindow
{
    bool IsBorderless { get; set; }
    bool IsMaximized { get; set; }
    bool IsResizable { get; set; }
    bool IsTopmost { get; set; }
    bool ShowInTaskbar { get; set; }
    void Activate();
    void Close();
    /// UI thread par baad me chalao (Closing/Deactivated handler ke andar se dialog nahi dikhate).
    void Post(Action action);
    event EventHandler Activated;
    event EventHandler Deactivated;
    event EventHandler<CancelEventArgs> Closing;
}
