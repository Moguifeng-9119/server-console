import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { CredentialInfo } from '../types';

export function CredentialStatus() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<CredentialInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api?.storeInfo().then((value) => { if (active) setInfo(value); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  return <div className={`credential-status ${info?.mode === 'session' ? 'session' : ''}`} role="status">
    <strong>{t(!api ? 'workbench.browserStorage' : error ? 'workbench.storageError' : !info ? 'workbench.storageChecking' : info.mode === 'encrypted' ? 'workbench.encrypted' : 'workbench.sessionOnly')}</strong>
    <p>{error || t(!api ? 'workbench.browserStorageNote' : info?.mode === 'encrypted' ? 'workbench.encryptedNote' : info?.mode === 'session' ? 'workbench.sessionNote' : 'workbench.storageChecking')}</p>
    {info?.migrationError && <p role="alert">{info.migrationError}</p>}
    {info && <small>{t('workbench.storageBackend')}: <span className="mono">{info.backend}</span></small>}
  </div>;
}
