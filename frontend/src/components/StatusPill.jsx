import { Icon, STATUS_ICON, STATUS_LABEL } from './Icons.jsx';

export const StatusPill = ({ status, children }) => (
  <span className={`pill ${status}`}>
    {STATUS_ICON[status] && <Icon name={STATUS_ICON[status]} size={12} />}
    {children ?? STATUS_LABEL[status] ?? status}
  </span>
);

const VERDICT_TONE = { VERIFIED: 'verified', UNKNOWN: 'unknown', CONTRADICTED: 'contradicted' };
export const VerdictPill = ({ verdict }) => <span className={`pill ${VERDICT_TONE[verdict] ?? 'neutral'}`}>{verdict}</span>;
