export default function Button({ variant = "primary", size, type = "button", className = "", children, ...rest }) {
  return (
    <button type={type} className={`btn btn-${variant}${size ? ` btn-${size}` : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}
