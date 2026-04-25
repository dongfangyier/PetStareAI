import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');
import './ConfigPanel.css';

const DEFAULT_CONFIG = {
  apiKey: '',
  defaultModel: 'claude-3-opus-20240229',
  agents: [],
  skills: [],
  hooks: {
    onComplete: true,
    onError: true,
  },
};

function ConfigPanel({ isOpen, onClose }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [newAgent, setNewAgent] = useState('');
  const [newSkill, setNewSkill] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Load saved config
      ipcRenderer.invoke('load-config').then((saved) => {
        if (saved) {
          setConfig({ ...DEFAULT_CONFIG, ...saved });
        }
      });
    }
  }, [isOpen]);

  const handleSave = () => {
    ipcRenderer.send('save-config', config);
    onClose();
  };

  const addAgent = () => {
    if (newAgent.trim()) {
      setConfig(prev => ({
        ...prev,
        agents: [...prev.agents, newAgent.trim()],
      }));
      setNewAgent('');
    }
  };

  const removeAgent = (index) => {
    setConfig(prev => ({
      ...prev,
      agents: prev.agents.filter((_, i) => i !== index),
    }));
  };

  const addSkill = () => {
    if (newSkill.trim()) {
      setConfig(prev => ({
        ...prev,
        skills: [...prev.skills, newSkill.trim()],
      }));
      setNewSkill('');
    }
  };

  const removeSkill = (index) => {
    setConfig(prev => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };

  const handleChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleHookChange = (hook, value) => {
    setConfig(prev => ({
      ...prev,
      hooks: { ...prev.hooks, [hook]: value },
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="config-overlay" onClick={onClose}>
      <div className="config-panel" onClick={e => e.stopPropagation()}>
        <h2>Claude Code Configuration</h2>

        <div className="config-field">
          <label>API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={e => handleChange('apiKey', e.target.value)}
            placeholder="sk-ant-..."
          />
        </div>

        <div className="config-field">
          <label>Default Model</label>
          <select
            value={config.defaultModel}
            onChange={e => handleChange('defaultModel', e.target.value)}
          >
            <option value="claude-3-opus-20240229">Claude 3 Opus</option>
            <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
            <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
          </select>
        </div>

        <div className="config-section">
          <h3>Your Agents ({config.agents.length})</h3>
          <div className="config-add">
            <input
              type="text"
              value={newAgent}
              onChange={e => setNewAgent(e.target.value)}
              placeholder="Add an agent..."
              onKeyDown={e => e.key === 'Enter' && addAgent()}
            />
            <button className="btn-add" onClick={addAgent}>Add</button>
          </div>
          <div className="list-items">
            {config.agents.map((agent, index) => (
              <div key={index} className="list-item">
                <span>{agent}</span>
                <button onClick={() => removeAgent(index)}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="config-section">
          <h3>Your Skills ({config.skills.length})</h3>
          <div className="config-add">
            <input
              type="text"
              value={newSkill}
              onChange={e => setNewSkill(e.target.value)}
              placeholder="Add a skill..."
              onKeyDown={e => e.key === 'Enter' && addSkill()}
            />
            <button className="btn-add" onClick={addSkill}>Add</button>
          </div>
          <div className="list-items">
            {config.skills.map((skill, index) => (
              <div key={index} className="list-item">
                <span>{skill}</span>
                <button onClick={() => removeSkill(index)}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="config-section">
          <h3>Notifications</h3>
          <div className="config-checkbox">
            <label>
              <input
                type="checkbox"
                checked={config.hooks.onComplete}
                onChange={e => handleHookChange('onComplete', e.target.checked)}
              />
              Notify on completion
            </label>
          </div>
          <div className="config-checkbox">
            <label>
              <input
                type="checkbox"
                checked={config.hooks.onError}
                onChange={e => handleHookChange('onError', e.target.checked)}
              />
              Notify on error
            </label>
          </div>
        </div>

        <div className="config-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default ConfigPanel;
