import { createElement, useCallback, useEffect, useState } from "react";
//#region src/client/index.tsx
/**
* Client half of dsh-oauth: registers an "OAuth 提供方" section in
* Settings with provider list, login/logout buttons, status display,
* and model catalog preview.
*/
const inject = ["slots", "locale"];
function apply(ctx) {
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "dsh-oauth",
		order: 15,
		label: () => "OAuth 提供方",
		inject: { t: (s) => s }
	}, OAuthSection));
}
function OAuthSection() {
	const [providers, setProviders] = useState([]);
	const [selected, setSelected] = useState("");
	const [models, setModels] = useState([]);
	const [loading, setLoading] = useState(false);
	const [actionText, setActionText] = useState("");
	const [error, setError] = useState("");
	const fetchProviders = useCallback(async () => {
		try {
			const data = await (await fetch("/oauth/api/providers")).json();
			setProviders(data);
			setSelected((prev) => prev || data[0]?.name || "");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	const fetchModels = useCallback(async (provider) => {
		if (!provider) {
			setModels([]);
			return;
		}
		try {
			const data = await (await fetch(`/oauth/api/models?provider=${encodeURIComponent(provider)}`)).json();
			setModels(data.ok ? data.models : []);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		fetchProviders();
	}, [fetchProviders]);
	useEffect(() => {
		fetchModels(selected);
	}, [selected, fetchModels]);
	const handleLogin = async () => {
		if (!selected) return;
		setLoading(true);
		setError("");
		setActionText("");
		try {
			const data = await (await fetch("/oauth/api/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: selected })
			})).json();
			if (data.ok) {
				setActionText(data.text);
				setTimeout(() => void fetchProviders(), 3e3);
			} else setError(data.error || data.text);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};
	const handleLogout = async () => {
		if (!selected) return;
		setLoading(true);
		setError("");
		setActionText("");
		try {
			const data = await (await fetch("/oauth/api/logout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: selected })
			})).json();
			if (data.ok) {
				setActionText(data.text);
				fetchProviders();
			} else setError(data.error || data.text);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};
	const current = providers.find((p) => p.name === selected);
	const isLoggedIn = current?.loggedIn ?? false;
	const sectionStyle = {
		padding: "16px",
		display: "flex",
		flexDirection: "column",
		gap: "12px"
	};
	const btnPrimary = {
		padding: "6px 16px",
		fontSize: "13px",
		fontWeight: 500,
		borderRadius: "6px",
		border: "none",
		background: "#185FA5",
		color: "#fff",
		cursor: loading ? "wait" : "pointer",
		opacity: loading || !selected ? .6 : 1
	};
	const btnOutline = {
		padding: "6px 16px",
		fontSize: "13px",
		fontWeight: 500,
		borderRadius: "6px",
		border: "1px solid #ccc",
		background: "transparent",
		cursor: loading ? "wait" : "pointer"
	};
	const badgeStyle = {
		display: "inline-block",
		padding: "2px 8px",
		borderRadius: "4px",
		fontSize: "11px",
		fontWeight: 500,
		background: isLoggedIn ? "#EAF3DE" : "#f0f0f0",
		color: isLoggedIn ? "#173404" : "#666"
	};
	const modelCard = {
		padding: "8px 12px",
		borderRadius: "6px",
		border: "1px solid #eee",
		fontSize: "12px"
	};
	const providerOptions = providers.map((p) => createElement("option", {
		key: p.name,
		value: p.name
	}, `${p.label} ${p.loggedIn ? "✓" : ""}`));
	const modelCards = models.map((m) => createElement("div", {
		key: m.id,
		style: modelCard
	}, createElement("div", { style: { fontWeight: 500 } }, `${m.name} (${m.id})`), createElement("div", { style: { opacity: .7 } }, `${Math.round(m.contextWindow / 1e3)}K ctx · ${Math.round(m.maxTokens / 1e3)}K output · ${m.api}`), createElement("div", { style: { opacity: .7 } }, `输入: ${m.input.join(", ")}` + (m.reasoning ? ` · 推理: ${typeof m.reasoning === "boolean" ? "支持" : Object.keys(m.reasoning).join("/")}` : ""))));
	return createElement("div", { style: sectionStyle }, createElement("h3", { style: {
		margin: 0,
		fontSize: "14px",
		fontWeight: 500
	} }, "OAuth 提供方"), createElement("p", { style: {
		margin: 0,
		fontSize: "12px",
		opacity: .7
	} }, "通过 OAuth 登录 pi-ai 支持的 provider，无需 API Key。登录后在\"模型\"区块把 provider 的 apiKeyEnv 指向对应的 credential ref 即可使用。"), createElement("div", { style: {
		display: "flex",
		gap: "8px",
		alignItems: "center"
	} }, createElement("span", { style: {
		fontSize: "13px",
		fontWeight: 500
	} }, "提供方"), createElement("select", {
		value: selected,
		onChange: (e) => setSelected(e.target.value),
		style: {
			padding: "4px 8px",
			fontSize: "13px",
			borderRadius: "6px"
		}
	}, providerOptions)), current ? createElement("div", { style: { fontSize: "12px" } }, createElement("span", { style: badgeStyle }, isLoggedIn ? "已登录" : "未登录"), createElement("span", { style: {
		marginLeft: "8px",
		opacity: .6
	} }, `凭证: ${current.credentialRef}`)) : null, createElement("div", { style: {
		display: "flex",
		gap: "8px"
	} }, createElement("button", {
		onClick: handleLogin,
		disabled: loading || !selected,
		style: btnPrimary
	}, loading ? "处理中…" : isLoggedIn ? "重新登录" : "登录"), isLoggedIn ? createElement("button", {
		onClick: handleLogout,
		disabled: loading,
		style: btnOutline
	}, "登出") : null), actionText ? createElement("div", { style: {
		padding: "8px 12px",
		fontSize: "12px",
		borderRadius: "6px",
		background: "#f5f5f5",
		whiteSpace: "pre-wrap",
		wordBreak: "break-all"
	} }, actionText) : null, error ? createElement("div", { style: {
		padding: "8px 12px",
		fontSize: "12px",
		borderRadius: "6px",
		background: "#FCEBEB",
		color: "#501313"
	} }, error) : null, selected && models.length > 0 ? createElement("div", { style: { marginTop: "8px" } }, createElement("h4", { style: {
		margin: "0 0 8px 0",
		fontSize: "13px",
		fontWeight: 500
	} }, `可用模型 (${models.length})`), createElement("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: "4px"
	} }, modelCards)) : null, selected && models.length === 0 ? createElement("div", { style: {
		fontSize: "12px",
		opacity: .5
	} }, "该 provider 暂无内置模型目录") : null);
}
//#endregion
export { apply, inject };
