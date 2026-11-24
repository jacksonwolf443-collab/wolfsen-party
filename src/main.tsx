import React from 'react';
import {createRoot} from 'react-dom/client';
import PartyConsole from './console';
import './styles.css';
import './activity-rules.css';
import './scores.css';
import './drawing.css';
import './pair-tournament.css';
import './stage-live.css';
import './crop.css';
import './fans.css';
import './mission-finale.css';
import './party-summary.css';
import './pair-summary.css';
import './refinement111.css';
import './live-projection.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return{error:error.message};}render(){if(this.state.error)return <div className="fatal-error"><h1>界面出现了问题</h1><p>已保存的本地档案没有被清除。请关闭程序重新打开。</p><pre>{this.state.error}</pre><button onClick={()=>location.reload()}>重新读取存档</button></div>;return this.props.children;}}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><PartyConsole/></ErrorBoundary>);

import './page-clear-controls.css';

import './game116.css';
import './tails-grouping.css';
import './fans-celebration.css';
import './player-photo-display.css';
import './voice-activity.css';
