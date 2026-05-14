export default function AulaButton({
  children,
  href,
  variant = "primary",
  type = "button",
  className = "",
  ...props
}) {
  const classes = ["aula-button", `aula-button-${variant}`, className]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <a className={classes} href={href} {...props}>
        {children}
      </a>
    );
  }

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
