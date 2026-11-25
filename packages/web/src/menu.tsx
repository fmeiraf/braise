import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./marks.tsx";

export interface MenuOption<Value extends string> {
	value: Value;
	label: string;
	glyph?: ReactNode;
	sub?: string;
	accent?: string;
}

interface Placement {
	left: number;
	top: number;
	up: boolean;
	accent: string;
}

/**
 * The braise menu: a button that opens a listbox with a gliding highlight. Arrow keys move, Enter picks,
 * number keys pick by position, Escape closes. `children` replaces the button's content.
 */
export function Select<Value extends string>(props: {
	value: Value;
	options: readonly MenuOption<Value>[];
	onChange: (value: Value) => void;
	title: string;
	className?: string;
	above?: boolean;
	disabled?: boolean;
	tip?: string;
	children?: ReactNode;
}) {
	const { options, value } = props;
	const [open, setOpen] = useState(false);
	const [index, setIndex] = useState(0);
	const [placement, setPlacement] = useState<Placement | null>(null);
	const anchor = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const cursor = useRef<HTMLElement>(null);
	const listId = useId();
	const current = options.find((option) => option.value === value) ?? options[0];

	const show = () => {
		setIndex(
			Math.max(
				0,
				options.findIndex((option) => option.value === value),
			),
		);

		setPlacement(null);

		setOpen(true);
	};

	const pick = (at: number) => {
		const option = options[at];

		setOpen(false);

		if (option !== undefined && option.value !== value) props.onChange(option.value);
	};

	useLayoutEffect(() => {
		const button = anchor.current;
		const box = list.current;

		if (!open || button === null || box === null || placement !== null) return;

		const rect = button.getBoundingClientRect();
		const up = props.above === true || rect.bottom + box.offsetHeight + 8 > window.innerHeight;

		setPlacement({
			left: Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8)),
			top: up ? rect.top - box.offsetHeight - 5 : rect.bottom + 5,
			up,
			accent: getComputedStyle(button).getPropertyValue("--acc"),
		});
	}, [open, placement, props.above]);

	useLayoutEffect(() => {
		const option = list.current?.querySelectorAll<HTMLElement>(".opt")[index];
		const mark = cursor.current;

		if (!open || option === undefined || mark === null) return;

		mark.style.translate = `0 ${option.offsetTop}px`;

		mark.style.height = `${option.offsetHeight}px`;

		option.scrollIntoView({ block: "nearest" });
	}, [open, index]);

	useEffect(() => {
		if (!open) return;

		const close = (event: Event) => {
			const target = event.target as Node | null;

			if (
				target !== null &&
				(list.current?.contains(target) === true || anchor.current?.contains(target) === true)
			) {
				return;
			}

			setOpen(false);
		};

		document.addEventListener("mousedown", close);

		window.addEventListener("resize", close);

		window.addEventListener("scroll", close, true);

		return () => {
			document.removeEventListener("mousedown", close);

			window.removeEventListener("resize", close);

			window.removeEventListener("scroll", close, true);
		};
	}, [open]);

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!open) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();

				show();
			}

			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();

			setIndex((index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();

			pick(index);
		} else if (event.key === "Escape") {
			event.preventDefault();

			event.stopPropagation();

			setOpen(false);
		} else if (event.key === "Tab") {
			setOpen(false);
		} else if (/^[1-9]$/u.test(event.key) && Number(event.key) <= options.length) {
			event.preventDefault();

			pick(Number(event.key) - 1);
		}
	};

	return (
		<>
			<button
				ref={anchor}
				type="button"
				className={props.className ?? "sel"}
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-activedescendant={open ? `${listId}-${index}` : undefined}
				aria-label={`${props.title}: ${current?.label ?? ""}`}
				data-tip={open ? undefined : props.tip}
				disabled={props.disabled}
				onClick={() => (open ? setOpen(false) : show())}
				onKeyDown={onKeyDown}
				onBlur={() => setOpen(false)}
			>
				{props.children ?? (
					<>
						{current?.glyph}
						<span>{current?.label}</span>
						<Icon name="chevd" className="chev" />
					</>
				)}
			</button>
			{open
				? createPortal(
						<div
							ref={list}
							id={listId}
							className="pop"
							role="listbox"
							aria-label={props.title}
							style={
								{
									left: placement?.left ?? 0,
									top: placement?.top ?? 0,
									visibility: placement === null ? "hidden" : undefined,
									transformOrigin: placement?.up === true ? "bottom left" : undefined,
									"--acc": placement?.accent === "" ? undefined : placement?.accent,
								} as CSSProperties
							}
						>
							<div className="pop-h cap">{props.title}</div>
							<i className="cur" ref={cursor} />
							{options.map((option, at) => (
								<div
									key={option.value}
									id={`${listId}-${at}`}
									role="option"
									tabIndex={-1}
									aria-selected={option.value === value}
									className={at === index ? "opt on" : "opt"}
									style={
										option.accent === undefined ? undefined : ({ "--acc": option.accent } as CSSProperties)
									}
									onMouseEnter={() => setIndex(at)}
									onMouseDown={(event) => {
										event.preventDefault();

										pick(at);
									}}
								>
									{option.glyph}
									<span>{option.label}</span>
									{option.sub === undefined ? null : <span className="sub">{option.sub}</span>}
									{option.value === value ? <Icon name="check" className="tick" /> : null}
									<span className="k">{at < 9 ? at + 1 : ""}</span>
								</div>
							))}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
