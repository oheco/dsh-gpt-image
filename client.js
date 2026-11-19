window.__ModuleLoader__.load({
  id: '@oheco/dsh-gpt-image',
  factory(require) {
    const React = require('react');
    const { createElement: h, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } = React;
    const PACKAGE = '@oheco/dsh-gpt-image';
    const NAMESPACE = 'oheco-gpt-image';
    const LOCALE = 'oheco.gptImage.settings';
    const DEFAULTS = {
      provider: '', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY',
      defaultModel: 'gpt-image-2.5-flare', defaultEditModel: 'gpt-image-2.5-sunburst',
    };
    const MODELS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
    const REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const ENDPOINT_FIELDS = ['baseURL', 'apiKeyEnv'];
    const labels = {
      en: {
        summary: 'Configure the image API connection and default models.',
        title: 'Images API settings',
        loading: 'Loading settings…',
        unavailable: 'These settings are unavailable. Check that the GPT Image plugin is enabled on the Host.',
        loadFailed: 'Could not load GPT Image settings.',
        refreshFailed: 'Could not refresh settings. Reconnect to the Host before saving.',
        retry: 'Reload page',
        readOnly: 'These settings are read-only.',
        provider: 'Authentication',
        standalone: 'Standalone Images API',
        existingConnections: 'Reuse a DSH connection',
        currentConnection: 'Currently configured connection',
        providerHelp: 'Reuse an OpenAI-compatible API-key connection from Settings → Models, or configure a standalone endpoint. This does not follow the chat model.',
        suggestionsUnavailable: 'The DSH connection list could not be loaded.',
        noConnections: 'No eligible connections were found in Settings → Models.',
        unlistedConnection: 'The currently configured connection is not listed as eligible. Verify it in Settings → Models.',
        connectionKeys: 'Manage this connection’s API key in Settings → Models.',
        baseURL: 'Images API base URL',
        baseHelp: 'Enter the API prefix, such as https://api.openai.com/v1, not the full image generation URL.',
        invalidBase: 'Use an absolute HTTPS URL (HTTP is allowed for localhost), without embedded credentials, a query, or a fragment.',
        confirmTarget: 'Image requests will send the key referenced by {reference} to {origin}. Continue only if you trust this server. Use a separate credential reference for each provider.',
        apiKeyEnv: 'Credential reference',
        refHelp: 'Enter a reference name, not the key itself. The default is OPENAI_API_KEY.',
        invalidRef: 'Use an environment-variable name: letters, digits, and underscores, starting with a letter or underscore.',
        defaultModel: 'Default generation model',
        defaultEditModel: 'Default editing model',
        save: 'Save settings',
        saving: 'Saving…',
        discard: 'Discard changes',
        saved: 'Settings saved.',
        conflict: 'Settings changed on the Host. Discard your changes to load the latest values.',
        settingsRefused: 'The Host did not accept these settings. Check whether a higher-priority configuration overrides them.',
        settingsFailed: 'Could not save settings. Try again.',
        key: 'New API key',
        keyHelp: 'Saving writes to DSH’s credential store, not your environment. Other connections and plugins that use the same reference share this key. DSH may also use an environment variable with that name.',
        keyNeedsSettings: 'Save a valid standalone endpoint and credential reference before entering an API key.',
        keyChecking: 'Checking credential status…',
        keyPresent: 'A key is configured for this reference.',
        keyFromStore: 'DSH is using a stored key. Saving a new one replaces it.',
        keyFromEnvironment: 'DSH is using an environment key. A stored key takes precedence.',
        invalidKey: 'Enter a key containing only printable ASCII characters, with no spaces.',
        keyMissing: 'No key is configured for this reference.',
        keyUnavailable: 'Could not check credential status. Reopen this page to try again.',
        keyReadOnly: 'This credential reference is read-only.',
        keySave: 'Save API key',
        keySaved: 'API key saved.',
        keyFailed: 'Could not save the API key. Check the credential store and try again.',
        keyTargetChanged: 'The saved endpoint or credential reference changed. Verify the settings and enter the key again.',
      },
      zh: {
        summary: '配置图片 API 连接与默认模型。',
        title: '图片 API 设置',
        loading: '正在读取设置…',
        unavailable: '无法读取这些设置。请检查 Host 是否已启用 GPT Image 插件。',
        loadFailed: '无法读取 GPT Image 设置。',
        refreshFailed: '无法刷新设置。请重新连接 Host 后再保存。',
        retry: '重新加载页面',
        readOnly: '这些设置为只读。',
        provider: '认证方式',
        standalone: '独立 Images API',
        existingConnections: '复用 DSH 连接',
        currentConnection: '当前配置的连接',
        providerHelp: '可复用「设置 → 模型」中兼容 OpenAI 且使用 API 密钥的连接，也可单独配置端点。此设置不随聊天模型切换。',
        suggestionsUnavailable: '无法读取 DSH 连接列表。',
        noConnections: '在「设置 → 模型」中未找到符合条件的连接。',
        unlistedConnection: '当前配置的连接未出现在可复用列表中，请在「设置 → 模型」核对。',
        connectionKeys: '请在「设置 → 模型」中管理此连接的 API 密钥。',
        baseURL: '图片 API 基础地址',
        baseHelp: '请输入 API 前缀，例如 https://api.openai.com/v1，不要填写完整的图片生成请求地址。',
        invalidBase: '请输入绝对 HTTPS 地址（本机可用 HTTP），不要包含用户名、密码、查询参数或片段。',
        confirmTarget: '图片请求将把 {reference} 所引用的密钥发给 {origin}。请确认你信任该服务器。建议为不同的服务商使用独立的凭据引用。',
        apiKeyEnv: '凭据引用名称',
        refHelp: '请填写引用名称，不要填写密钥本身。默认为 OPENAI_API_KEY。',
        invalidRef: '请输入环境变量名称：以字母或下划线开头，其余字符只能是字母、数字或下划线。',
        defaultModel: '默认生成模型',
        defaultEditModel: '默认编辑模型',
        save: '保存设置',
        saving: '保存中…',
        discard: '放弃修改',
        saved: '设置已保存。',
        conflict: 'Host 上的设置已变更。请放弃当前修改以载入最新设置。',
        settingsRefused: 'Host 拒绝了此次保存。请检查是否有优先级更高的配置覆盖了这些设置。',
        settingsFailed: '无法保存设置，请重试。',
        key: '新的 API 密钥',
        keyHelp: '保存会写入 DSH 凭据存储，不会修改环境变量。使用相同引用的连接和插件会共享此密钥。DSH 也可读取同名环境变量。',
        keyNeedsSettings: '请先保存有效的独立端点和凭据引用，再输入 API 密钥。',
        keyChecking: '正在检查凭据状态…',
        keyPresent: '此引用已配置密钥。',
        keyFromStore: '当前使用 DSH 凭据库中的密钥，保存新密钥会将其替换。',
        keyFromEnvironment: '当前使用环境变量中的密钥，保存到 DSH 的密钥将优先生效。',
        invalidKey: '密钥只能包含可打印的 ASCII 字符，不能有空格。',
        keyMissing: '此引用尚未配置密钥。',
        keyUnavailable: '无法检查凭据状态，请重新打开此页面重试。',
        keyReadOnly: '此凭据引用为只读。',
        keySave: '保存 API 密钥',
        keySaved: 'API 密钥已保存。',
        keyFailed: '无法保存 API 密钥，请检查凭据存储后重试。',
        keyTargetChanged: '已保存的端点或凭据引用已更改。请核对设置后重新输入密钥。',
      },
    };

    const STYLE = `
      .oheco-gpt-image { display: grid; gap: 12px; max-inline-size: 42rem; padding-block: 12px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
      .oheco-gpt-image h3, .oheco-gpt-image p { margin: 0; }
      .oheco-gpt-image h3 { font-size: 14px; font-weight: 600; }
      .oheco-gpt-image p { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .oheco-gpt-image .ogi-field, .oheco-gpt-image .ogi-key { display: grid; gap: 5px; min-width: 0; }
      .oheco-gpt-image .ogi-key { gap: 8px; border-block-start: 1px solid var(--dsw-alias-border-l3); padding-block-start: 12px; }
      .oheco-gpt-image .ogi-models { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
      .oheco-gpt-image input, .oheco-gpt-image select, .oheco-gpt-image button { box-sizing: border-box; min-height: 34px; font: inherit; color: inherit; border: 1px solid var(--dsw-alias-border-l3); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); padding: 5px 9px; }
      .oheco-gpt-image input, .oheco-gpt-image select { width: 100%; min-width: 0; }
      .oheco-gpt-image option { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
      .oheco-gpt-image button:not(:disabled) { cursor: pointer; }
      .oheco-gpt-image button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-state-business-primary); }
      .oheco-gpt-image :disabled { opacity: .65; }
      .oheco-gpt-image :focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .oheco-gpt-image [aria-invalid=true] { border-color: var(--dsw-alias-state-error-primary); }
      .oheco-gpt-image .ogi-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .oheco-gpt-image .ogi-error { color: var(--dsw-alias-state-error-primary); }
    `;

    // Mirror the Host's endpoint checks. In particular, don't echo an invalid
    // stored URL that may contain username/password or token query parameters.
    function validEndpoint(value) {
      try {
        const url = new URL(value);
        const supported = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
        return supported && !url.username && !url.password && !url.search && !url.hash;
      } catch {
        return false;
      }
    }

    function readValues(value) {
      const fields = Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) =>
        [key, typeof value?.[key] === 'string' ? value[key] : fallback]));
      if (!validEndpoint(fields.baseURL)) fields.baseURL = '';
      if (!REF.test(fields.apiKeyEnv)) fields.apiKeyEnv = '';
      return fields;
    }

    function eligibleIds(directory, namespaces) {
      const owners = new Map(namespaces.map(namespace => [namespace.ns, namespace]));
      const counts = new Map();
      for (const entry of directory) counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1);
      return directory.filter(({ provider, settingsNs, settingsPath }) => {
        const owner = owners.get(settingsNs);
        const profile = settingsPath.reduce((section, part) => section && Object.hasOwn(section, part) ? section[part] : undefined, owner?.value);
        // The Host rejects custom headers. They may have been redacted out of
        // the resolved profile, so also check the namespace's redaction metadata.
        const hasSecretHeaders = owner?.secrets?.some(({ path, set }) => set && path[settingsPath.length] === 'headers'
          && settingsPath.every((part, index) => part === path[index]));
        return provider && counts.get(provider) === 1 && ['openai-responses', 'openai-completions'].includes(profile?.api)
          && typeof profile.apiKeyEnv === 'string' && REF.test(profile.apiKeyEnv)
          && typeof profile.baseURL === 'string' && validEndpoint(profile.baseURL)
          && !hasSecretHeaders && (!profile.headers || Object.keys(profile.headers).length === 0);
      }).map(entry => entry.provider).sort();
    }

    function useSnapshot(store) {
      // The ConfigForms and describe-face methods require their receiver.
      const subscribe = useCallback(listener => store.subscribe(listener), [store]);
      const get = useCallback(() => store.getSnapshot(), [store]);
      return useSyncExternalStore(subscribe, get);
    }

    function line(t, key, role) {
      return key ? h('p', { role, className: role === 'alert' ? 'ogi-error' : undefined }, t(key)) : null;
    }

    function Field({ id, title, help, error, children }) {
      const control = React.cloneElement(children, {
        id, 'aria-describedby': error || help ? `${id}-help` : undefined, 'aria-invalid': error ? true : undefined,
      });
      return h('div', { className: 'ogi-field' }, h('label', { htmlFor: id }, title), control,
        error || help ? h('p', { id: `${id}-help`, className: error ? 'ogi-error' : undefined }, error || help) : null);
    }

    function KeyEditor({ t, reference, api, writable, pending, run, stillCurrent }) {
      const id = useId();
      const input = useRef(null);
      const [hasInput, setHasInput] = useState(false);
      const [info, setInfo] = useState(null);
      const [notice, setNotice] = useState(null);
      const [check, setCheck] = useState(0);
      const alive = useRef(false);
      useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      useEffect(() => {
        let active = true;
        void api.describeKey(reference).then(result => { if (active) setInfo(result); });
        return () => { active = false; };
      }, [api, check, reference]);

      const canEnter = writable && info?.writable === true && !pending;
      function saveKey() {
        if (!canEnter || !hasInput) return;
        void run('key', async () => {
          const secret = input.current?.value.trim();
          if (input.current) input.current.value = '';
          setHasInput(false);
          setNotice(null);
          if (!secret) return;
          if (!/^[\x21-\x7e]+$/.test(secret)) { setNotice('invalidKey'); return; }
          if (!stillCurrent()) { setNotice('keyTargetChanged'); return; }
          const accepted = await api.saveKey(reference, secret);
          if (!alive.current) return;
          setNotice(accepted ? 'keySaved' : 'keyFailed');
          setInfo(null);
          setCheck(count => count + 1);
        });
      }

      const status = info === null ? 'keyChecking' : !info ? 'keyUnavailable' : !info.configured ? 'keyMissing'
        : info.source === 'file' ? 'keyFromStore' : info.source === 'env' ? 'keyFromEnvironment' : 'keyPresent';
      return h(React.Fragment, null,
        line(t, status, 'status'),
        info && !info.writable ? line(t, 'keyReadOnly', 'status') : null,
        h(Field, { id, title: t('key'), help: t('keyHelp'), error: notice === 'invalidKey' ? t('invalidKey') : undefined }, h('input', {
          ref: input, type: 'password', autoComplete: 'new-password', disabled: !canEnter, spellCheck: false, maxLength: 4096,
          onChange: event => { setHasInput(event.currentTarget.value.trim().length > 0); setNotice(null); },
          onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); saveKey(); } },
        })),
        h('div', { className: 'ogi-actions' }, h('button', { type: 'button', disabled: !canEnter || !hasInput, onClick: saveKey },
          t(pending === 'key' ? 'saving' : 'keySave'))),
        line(t, notice, notice === 'keySaved' ? 'status' : 'alert'));
    }

    function Settings({ t, settingsForm, describe, api }) {
      const id = useId();
      const snapshot = useSnapshot(settingsForm);
      const mirror = useSnapshot(describe);
      const [draft, setDraft] = useState(null);
      const [notice, setNotice] = useState(null);
      const [directory, setDirectory] = useState(null);
      const [pending, setPending] = useState(null);
      const busy = useRef(false);
      const alive = useRef(false);
      const ready = snapshot.status === 'ready';
      const writable = ready && Number.isInteger(snapshot.revision) && snapshot.writable === true && mirror.error === null;
      useEffect(() => {
        alive.current = true;
        void describe.ensure();
        return () => { alive.current = false; };
      }, [describe]);
      useEffect(() => {
        if (!ready) return;
        let active = true;
        void api.listConnections().then(rows => { if (active) setDirectory(rows); });
        return () => { active = false; };
      }, [api, ready, mirror.view]);

      const shell = (...children) => h('section', { className: 'oheco-gpt-image', 'aria-labelledby': `${id}-title` },
        h('style', null, STYLE), h('h3', { id: `${id}-title` }, t('title')), ...children);
      if (!ready) {
        if (mirror.error !== null && mirror.view === undefined) return shell(line(t, 'loadFailed', 'alert'),
          h('div', { className: 'ogi-actions' }, h('button', { type: 'button', onClick: () => window.location.reload() }, t('retry'))));
        // A completed describe with no usable namespace is not still loading.
        return shell(line(t, snapshot.status === 'loading' && !mirror.view ? 'loading' : 'unavailable', 'status'));
      }

      const saved = readValues(snapshot.value);
      const original = draft?.original ?? saved;
      const values = { ...original, ...draft?.changes };
      const normalized = field => values[field] === original[field] ? original[field] : values[field].trim();
      const standalone = normalized('provider') === '';
      const validBase = validEndpoint(normalized('baseURL'));
      const validRef = REF.test(normalized('apiKeyEnv'));
      // Selecting an existing connection must leave the saved standalone target alone.
      const ops = Object.keys(DEFAULTS).filter(field => (standalone || !ENDPOINT_FIELDS.includes(field)) && normalized(field) !== original[field])
        .map(field => ({ op: 'set', path: [field], value: normalized(field) }));
      const stale = draft !== null && draft.revision !== snapshot.revision;
      const stableTarget = standalone && values.provider === '' && saved.provider === '' && validBase && validRef
        && values.baseURL === saved.baseURL && values.apiKeyEnv === saved.apiKeyEnv;
      const suggestions = directory && mirror.view && mirror.error === null ? eligibleIds(directory, mirror.view.namespaces) : [];
      const providerAllowed = standalone ? validBase && validRef : values.provider === saved.provider || suggestions.includes(values.provider);
      const canSave = writable && !stale && !pending && ops.length > 0 && providerAllowed;
      const suggestionNotice = directory === false || mirror.error !== null ? 'suggestionsUnavailable'
        : directory === null ? null : !standalone && !suggestions.includes(values.provider) ? 'unlistedConnection'
          : !suggestions.length ? 'noConnections' : null;

      function change(field, value) {
        setNotice(null);
        setDraft(old => {
          const baseline = old ?? { original: saved, revision: snapshot.revision, changes: {} };
          const changes = { ...baseline.changes };
          if (value === baseline.original[field]) delete changes[field];
          else changes[field] = value;
          return Object.keys(changes).length ? { ...baseline, changes } : null;
        });
      }

      async function run(kind, action) {
        if (busy.current) return;
        busy.current = true;
        setPending(kind);
        try { await action(); }
        finally {
          busy.current = false;
          if (alive.current) setPending(null);
        }
      }

      function saveSettings() {
        if (!canSave) return;
        if (standalone) {
          const origin = new URL(normalized('baseURL')).origin;
          const oldOrigin = validEndpoint(saved.baseURL) ? new URL(saved.baseURL).origin : '';
          const reference = normalized('apiKeyEnv');
          if ((saved.provider !== '' || origin !== oldOrigin || reference !== saved.apiKeyEnv)
              && !window.confirm(t('confirmTarget', { origin, reference }))) return;
        }
        void run('settings', async () => {
          setNotice(null);
          try {
            // Pass the revision captured on first edit, not the latest render's.
            const accepted = await settingsForm.mutate(ops, draft.revision);
            if (!alive.current) return;
            if (accepted) setDraft(null);
            setNotice(accepted ? 'saved' : 'settingsRefused');
          } catch {
            if (alive.current) setNotice('settingsFailed');
          }
        });
      }

      function stillCurrent() {
        const current = settingsForm.getSnapshot();
        if (current.status !== 'ready' || current.writable !== true || !Number.isInteger(current.revision) || describe.getSnapshot().error !== null) return false;
        const values = readValues(current.value);
        return values.provider === '' && values.baseURL === saved.baseURL && values.apiKeyEnv === saved.apiKeyEnv;
      }

      const readOnly = !writable || Boolean(pending);
      const field = (name, props = {}, help, error) => h(Field, { id: `${id}-${name}`, title: t(name), help, error }, h('input', {
        type: 'text', spellCheck: false, autoComplete: 'off', value: values[name], readOnly,
        onChange: event => change(name, event.currentTarget.value), ...props,
      }));
      const model = name => h(Field, { id: `${id}-${name}`, title: t(name) }, h('select', {
        value: values[name], disabled: readOnly, onChange: event => change(name, event.currentTarget.value),
      }, MODELS.map(value => h('option', { key: value, value }, value))));

      const options = [...new Set([values.provider, saved.provider])].filter(value => value && !suggestions.includes(value));
      return shell(
        h(Field, { id: `${id}-provider`, title: t('provider'), help: t('providerHelp') }, h('select', {
          value: values.provider, disabled: readOnly, onChange: event => change('provider', event.currentTarget.value),
        }, h('option', { value: '' }, t('standalone')),
        suggestions.length ? h('optgroup', { label: t('existingConnections') }, suggestions.map(value => h('option', { key: value, value }, value))) : null,
        options.map(value => h('option', { key: value, value, disabled: value !== saved.provider }, `${t('currentConnection')}: ${value}`)))),
        line(t, suggestionNotice, 'status'),
        !standalone ? line(t, 'connectionKeys') : null,
        standalone ? field('baseURL', { inputMode: 'url', placeholder: DEFAULTS.baseURL }, t('baseHelp'), validBase ? undefined : t('invalidBase')) : null,
        standalone ? field('apiKeyEnv', { placeholder: DEFAULTS.apiKeyEnv }, t('refHelp'), validRef ? undefined : t('invalidRef')) : null,
        h('div', { className: 'ogi-models' }, model('defaultModel'), model('defaultEditModel')),
        mirror.error !== null ? line(t, 'refreshFailed', 'alert') : !writable ? line(t, 'readOnly', 'status') : null,
        h('div', { className: 'ogi-actions' },
          h('button', { type: 'button', disabled: !canSave, onClick: saveSettings }, t(pending === 'settings' ? 'saving' : 'save')),
          mirror.error !== null ? h('button', { type: 'button', onClick: () => window.location.reload() }, t('retry')) : null,
          draft ? h('button', { type: 'button', disabled: Boolean(pending), onClick: () => { setDraft(null); setNotice(null); } }, t('discard')) : null),
        stale && pending !== 'settings' ? line(t, 'conflict', 'alert') : line(t, notice, notice === 'saved' ? 'status' : 'alert'),
        standalone ? h('div', { className: 'ogi-key' },
          stableTarget ? h(KeyEditor, {
            // Unmount and clear the password field on any change of target.
            key: JSON.stringify([saved.baseURL, saved.apiKeyEnv]), t, reference: saved.apiKeyEnv, api,
            writable, pending, run, stillCurrent,
          }) : line(t, 'keyNeedsSettings', 'status')) : null);
    }

    function Entry({ view, t, ...props }) {
      if (view === 'summary') return h('span', null, t('summary'));
      return view === 'page' ? h(Settings, { t, ...props }) : null;
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.llm', 'remote.credentials'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(LOCALE, labels), 'oheco-gpt-image: settings locale');
        const settingsForm = ctx.configForms.get(NAMESPACE);
        const describe = ctx.configForms.describe(); // The shared remote.settings.describe mirror.
        const api = {
          async listConnections() {
            try {
              const result = await ctx.remote.llm.listConfigurableProviders();
              return result.ok ? result.value : false;
            } catch { return false; }
          },
          async describeKey(reference) {
            try {
              const result = await ctx.remote.credentials.describe([reference]);
              const info = result.ok && Object.hasOwn(result.value, reference) ? result.value[reference] : undefined;
              // Retain presence and writability only, not even the masked value.
              return info ? { configured: info.configured === true, writable: info.writable === true, source: info.source } : false;
            } catch { return false; }
          },
          async saveKey(reference, secret) {
            try { return (await ctx.remote.credentials.set(reference, secret)).ok === true; }
            catch { return false; } // Never surface provider errors that could contain the key.
          },
        };
        const props = () => ({ settingsForm, describe, api });
        for (const [name, key] of [['plugins.bundle.config', PACKAGE], ['plugins.row.config', `${PACKAGE}#${NAMESPACE}`]]) {
          ctx.slots.inject(name, () => ctx.slots.register({ name, key, locale: LOCALE, inject: props }, Entry));
        }
      },
    };
  },
});
