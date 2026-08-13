import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Form, Input, Modal, Segmented, Spin } from "antd";
import { LockKeyhole, QrCode, RefreshCw, Smartphone } from "lucide-react";

import {
    createSucaiAuthClient,
    getSucaiQrImageSrc,
    readRememberedPhoneLogin,
    rememberPhoneLogin,
    saveSucaiSession,
    startWechatLoginPolling,
} from "@sucai-auth";
import "./canvas-login-modal.css";

export const CANVAS_LOGIN_REQUIRED_EVENT = "canvas-login-required";
const API_BASE = import.meta.env.VITE_SUCAI_API_BASE || "/flash-api";

type LoginMode = "wechat" | "phone";
type PhoneLoginForm = { account: string; password: string; remember: boolean };

export function requestCanvasLogin() {
    window.dispatchEvent(new Event(CANVAS_LOGIN_REQUIRED_EVENT));
}

export function CanvasLoginModal() {
    const { message } = App.useApp();
    const authClient = useMemo(() => createSucaiAuthClient(API_BASE), []);
    const stopPollingRef = useRef<null | (() => void)>(null);
    const qrRequestIdRef = useRef(0);
    const remembered = useMemo(readRememberedPhoneLogin, []);
    const [form] = Form.useForm<PhoneLoginForm>();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<LoginMode>("wechat");
    const [qrUrl, setQrUrl] = useState("");
    const [qrLoading, setQrLoading] = useState(false);
    const [qrExpired, setQrExpired] = useState(false);
    const [phoneLoading, setPhoneLoading] = useState(false);

    const stopPolling = () => {
        stopPollingRef.current?.();
        stopPollingRef.current = null;
    };

    const completeLogin = () => {
        stopPolling();
        setOpen(false);
        message.success("登录成功，正在同步画布账号");
        window.dispatchEvent(new Event("canvas-account-changed"));
    };

    const loadWechatQr = async () => {
        stopPolling();
        const requestId = ++qrRequestIdRef.current;
        setQrLoading(true);
        setQrExpired(false);
        setQrUrl("");
        try {
            const qr = await authClient.createWechatQr();
            if (requestId !== qrRequestIdRef.current) return;
            setQrUrl(qr.qr_url);
            stopPollingRef.current = startWechatLoginPolling(authClient, qr.scene_id, {
                onSuccess: completeLogin,
                onExpired: () => setQrExpired(true),
            });
        } catch (error) {
            setQrExpired(true);
            message.error(error instanceof Error ? error.message : "二维码加载失败");
        } finally {
            setQrLoading(false);
        }
    };

    useEffect(() => {
        const openLogin = () => {
            setMode("wechat");
            setOpen(true);
        };
        window.addEventListener(CANVAS_LOGIN_REQUIRED_EVENT, openLogin);
        return () => window.removeEventListener(CANVAS_LOGIN_REQUIRED_EVENT, openLogin);
    }, []);

    useEffect(() => {
        if (open && mode === "wechat") void loadWechatQr();
        if (!open || mode !== "wechat") {
            qrRequestIdRef.current += 1;
            stopPolling();
        }
        return () => {
            qrRequestIdRef.current += 1;
            stopPolling();
        };
    }, [open, mode]);

    const submitPhoneLogin = async (values: PhoneLoginForm) => {
        setPhoneLoading(true);
        try {
            const response = await authClient.loginWithPassword(values.account, values.password);
            if (!response.session_id) throw new Error("登录接口未返回有效会话");
            rememberPhoneLogin({ account: values.account.trim(), password: values.password, remember: values.remember });
            saveSucaiSession(response.session_id);
            completeLogin();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败，请稍后重试");
        } finally {
            setPhoneLoading(false);
        }
    };

    return (
        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            width={620}
            centered
            destroyOnHidden
            className="canvas-login-modal"
        >
            <header className="canvas-login-header">
                <img className="canvas-login-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
                <div className="canvas-login-brand">
                    <h2>登录闪帧账号</h2>
                    <p>一个账号，同步素材、画布与创作记录</p>
                </div>
            </header>

            <div className="canvas-login-content">
                <Segmented<LoginMode>
                    block
                    className="canvas-login-switch"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: "wechat", label: <span><QrCode />微信扫码</span> },
                        { value: "phone", label: <span><Smartphone />手机号登录</span> },
                    ]}
                />

                {mode === "wechat" ? (
                    <section className="canvas-login-qr-panel" aria-live="polite">
                        <div className="canvas-login-qr-shell">
                            {qrLoading ? <Spin size="large" /> : qrUrl && !qrExpired ? (
                                <img
                                    src={getSucaiQrImageSrc(qrUrl, 220)}
                                    alt="微信登录二维码"
                                    onError={() => setQrExpired(true)}
                                />
                            ) : (
                                <div className="canvas-login-qr-state">
                                    <QrCode />
                                    <span>二维码已失效</span>
                                    <Button icon={<RefreshCw />} onClick={() => void loadWechatQr()}>重新获取</Button>
                                </div>
                            )}
                        </div>
                        <strong>使用微信扫一扫登录</strong>
                        <p>扫码确认后，当前页面会自动完成登录</p>
                    </section>
                ) : (
                    <Form
                        form={form}
                        layout="vertical"
                        size="large"
                        className="canvas-login-form"
                        initialValues={remembered}
                        requiredMark={false}
                        validateTrigger="onBlur"
                        onFinish={submitPhoneLogin}
                    >
                        <Form.Item label="手机号" name="account" rules={[{ required: true, message: "请输入手机号" }, { pattern: /^1\d{10}$/, message: "请输入正确的手机号" }]}>
                            <Input prefix={<Smartphone />} placeholder="请输入手机号" autoComplete="username" maxLength={11} />
                        </Form.Item>
                        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password prefix={<LockKeyhole />} placeholder="请输入密码" autoComplete="current-password" />
                        </Form.Item>
                        <Form.Item name="remember" valuePropName="checked" className="canvas-login-remember">
                            <Checkbox>记住密码</Checkbox>
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={phoneLoading} block className="canvas-login-submit">
                            登录并继续
                        </Button>
                    </Form>
                )}

                <p className="canvas-login-terms">登录即代表同意《用户协议》和《隐私政策》</p>
            </div>
        </Modal>
    );
}
