// AI专用UI组件
// 负责AI消息的渲染、思考过程显示和用户交互

const AIUI = {
    // AI消息缓存
    aiMessageCache: new Map(),
    
    // 初始化AI UI
    init() {
        this.bindEvents();
    },
    
    // 绑定事件
    bindEvents() {
        // 监听思考过程切换事件
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('ai-thinking-toggle')) {
                this.toggleThinkingContent(e.target);
            }
        });
        
        // 监听AI模式变化
        document.addEventListener('aiModeChanged', (event) => {
            this.updateAIModeIndicator(event.detail.isAIMode);
        });
    },
    
    // 创建AI消息元素
    createAIMessageElement(message) {
        try {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ai fade-in';
            messageDiv.dataset.messageId = message.id;
            messageDiv.dataset.timestamp = message.timestamp;

            let content = '';
            if (message.type === CONFIG.MESSAGE_TYPES.AI_THINKING) {
                content = this.renderThinkingMessage(message);
            } else if (message.type === CONFIG.MESSAGE_TYPES.AI_RESPONSE) {
                content = this.renderResponseMessage(message);
            } else {
                // 降级处理：渲染为普通AI消息
                content = this.renderSimpleAIMessage(message);
            }

            if (!content) {
                console.error('AIUI: 消息内容为空');
                content = this.renderSimpleAIMessage(message);
            }

            messageDiv.innerHTML = content;

            return messageDiv;
        } catch (error) {
            console.error('AIUI: 创建AI消息元素失败', error);
            return null;
        }
    },
    
    // 渲染思考过程消息
    renderThinkingMessage(message) {
        const time = Utils.formatTime(message.timestamp);
        const thinkingId = `thinking-content-${message.id}`;
        
        return `
            <div class="message-content ai-thinking-message">
                <div class="ai-thinking-header">
                    <span class="ai-thinking-indicator">${CONFIG.AI.THINKING_INDICATOR}</span>
                    <button class="ai-thinking-toggle" data-target="${thinkingId}" title="展开/折叠思考过程">
                        <svg viewBox="0 0 24 24" width="12" height="12">
                            <path fill="currentColor" d="M7,10L12,15L17,10H7Z"/>
                        </svg>
                    </button>
                </div>
                <div class="ai-thinking-content collapsed" id="${thinkingId}">
                    <div class="thinking-text">${message.content}</div>
                </div>
            </div>
            <div class="message-meta">
                <span>${CONFIG.AI.RESPONSE_INDICATOR}</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    },
    
    // 渲染AI响应消息
    renderResponseMessage(message) {
        const time = Utils.formatTime(message.timestamp);
        const hasMarkdown = Utils.markdown && Utils.markdown.hasMarkdownSyntax(message.content);
        const messageId = `ai-msg-${message.id}`;

        // 处理内容渲染
        let displayContent = message.content || '';
        if (hasMarkdown && Utils.markdown && displayContent) {
            displayContent = Utils.markdown.renderToHtml(displayContent);
        } else {
            displayContent = this.escapeHtml(displayContent);
        }

        const textMessageClass = hasMarkdown ? 'text-message markdown-rendered' : 'text-message';
        const toggleButton = hasMarkdown && displayContent
            ? `<button class="markdown-toggle" onclick="AIUI.toggleMarkdownView('${messageId}')" title="切换源码/渲染视图">📝</button>`
            : '';

        // 添加AI响应特有的样式和标识
        const aiIndicator = message.isError ? '❌' : '🤖';
        const typingIndicator = !displayContent ? '<span class="ai-typing-indicator">▋</span>' : '';

        return `
            <div class="message-content ai-response-message">
                <div class="ai-response-header">
                    <span class="ai-response-indicator">${aiIndicator} ${CONFIG.AI.RESPONSE_INDICATOR}</span>
                </div>
                <div class="${textMessageClass}" id="${messageId}"
                     data-original="${this.escapeHtml(message.content || '')}"
                     data-rendered="${displayContent.replace(/"/g, '&quot;')}"
                     data-is-rendered="${hasMarkdown ? 'true' : 'false'}">
                    ${displayContent}${typingIndicator}${toggleButton}
                </div>
            </div>
            <div class="message-meta">
                <span>${CONFIG.AI.RESPONSE_INDICATOR}</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    },

    // 渲染简单AI消息（降级处理）
    renderSimpleAIMessage(message) {
        const time = Utils.formatTime(message.timestamp);
        const content = this.escapeHtml(message.content || '正在处理...');
        const indicator = message.isThinking ? '🤔 思考中' : '🤖 AI助手';

        return `
            <div class="message-content ai-response-message">
                <div class="ai-response-header">
                    <span class="ai-response-indicator">${indicator}</span>
                </div>
                <div class="text-message" id="ai-msg-${message.id}">
                    ${content}
                </div>
            </div>
            <div class="message-meta">
                <span>AI助手</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    },

    // 更新思考过程内容
    updateThinkingContent(thinkingId, thinking) {
        const thinkingElement = document.getElementById(`thinking-content-${thinkingId}`);
        if (thinkingElement) {
            const textElement = thinkingElement.querySelector('.thinking-text');
            if (textElement) {
                textElement.textContent = thinking || CONFIG.AI.THINKING_INDICATOR;
            }
        }
    },
    
    // 更新AI响应内容
    updateResponseContent(responseId, chunk, fullResponse) {
        // 尝试多种方式查找响应元素
        let responseElement = document.getElementById(`ai-msg-${responseId}`);
        if (!responseElement) {
            responseElement = document.querySelector(`[data-message-id="${responseId}"] .text-message`);
        }
        if (!responseElement) {
            responseElement = document.querySelector(`[data-message-id="${responseId}"] .ai-response-message .text-message`);
        }

        if (responseElement) {
            // 移除打字指示器
            const typingIndicator = responseElement.querySelector('.ai-typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }

            // 更新内容
            const hasMarkdown = Utils.markdown && Utils.markdown.hasMarkdownSyntax(fullResponse);
            let displayContent = fullResponse;

            if (hasMarkdown && Utils.markdown) {
                displayContent = Utils.markdown.renderToHtml(fullResponse);
                responseElement.classList.add('markdown-rendered');
            } else {
                displayContent = this.escapeHtml(fullResponse);
            }

            // 更新显示内容
            responseElement.innerHTML = displayContent;

            // 添加打字指示器（如果还在输入中）
            if (chunk) {
                responseElement.innerHTML += '<span class="ai-typing-indicator">▋</span>';
            }

            // 滚动到底部
            this.scrollToBottom();
        } else {
            console.warn('AIUI: 未找到响应元素', { responseId });
        }
    },
    
    // 完成AI响应
    completeResponse(responseId, finalContent) {
        // 尝试多种方式查找响应元素
        let responseElement = document.getElementById(`ai-msg-${responseId}`);
        if (!responseElement) {
            responseElement = document.querySelector(`[data-message-id="${responseId}"] .text-message`);
        }
        if (!responseElement) {
            responseElement = document.querySelector(`[data-message-id="${responseId}"]`);
        }

        if (responseElement) {
            // 移除打字指示器
            const typingIndicator = responseElement.querySelector('.ai-typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }

            // 添加完成标识
            responseElement.classList.add('ai-response-complete');
        } else {
            console.warn('AIUI: 未找到响应元素进行完成处理', { responseId });
        }
    },
    
    // 切换思考过程显示
    toggleThinkingContent(toggleButton) {
        const targetId = toggleButton.dataset.target;
        const thinkingContent = document.getElementById(targetId);
        
        if (thinkingContent) {
            const isCollapsed = thinkingContent.classList.contains('collapsed');
            
            if (isCollapsed) {
                thinkingContent.classList.remove('collapsed');
                thinkingContent.classList.add('expanded');
                toggleButton.innerHTML = `
                    <svg viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M7,14L12,9L17,14H7Z"/>
                    </svg>
                `;
            } else {
                thinkingContent.classList.remove('expanded');
                thinkingContent.classList.add('collapsed');
                toggleButton.innerHTML = `
                    <svg viewBox="0 0 24 24" width="12" height="12">
                        <path fill="currentColor" d="M7,10L12,15L17,10H7Z"/>
                    </svg>
                `;
            }
        }
    },
    
    // 切换Markdown视图
    toggleMarkdownView(messageId) {
        const messageElement = document.getElementById(messageId);
        if (!messageElement) return;
        
        const isRendered = messageElement.dataset.isRendered === 'true';
        const originalContent = messageElement.dataset.original;
        const renderedContent = messageElement.dataset.rendered;
        
        if (isRendered) {
            // 切换到源码视图
            messageElement.innerHTML = this.escapeHtml(originalContent);
            messageElement.classList.remove('markdown-rendered');
            messageElement.dataset.isRendered = 'false';
        } else {
            // 切换到渲染视图
            messageElement.innerHTML = renderedContent;
            messageElement.classList.add('markdown-rendered');
            messageElement.dataset.isRendered = 'true';
        }
        
        // 重新添加切换按钮
        const toggleButton = `<button class="markdown-toggle" onclick="AIUI.toggleMarkdownView('${messageId}')" title="切换源码/渲染视图">📝</button>`;
        messageElement.innerHTML += toggleButton;
    },
    
    // 更新AI模式指示器
    updateAIModeIndicator(isAIMode) {
        const inputContainer = document.querySelector('.input-container');
        if (!inputContainer) return;
        
        // 移除现有指示器
        const existingIndicator = inputContainer.querySelector('.ai-mode-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // 添加新指示器
        if (isAIMode) {
            const indicator = document.createElement('div');
            indicator.className = 'ai-mode-indicator';
            indicator.textContent = CONFIG.AI.MODE_INDICATOR;
            inputContainer.appendChild(indicator);
        }
    },
    
    // 滚动到底部
    scrollToBottom() {
        const messageList = document.getElementById('messageList');
        if (messageList) {
            messageList.scrollTop = messageList.scrollHeight;
        }
    },
    
    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // 移除AI消息
    removeAIMessage(messageId) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.remove();
            this.aiMessageCache.delete(messageId);
        }
    },
    
    // 获取AI UI状态
    getStatus() {
        return {
            cacheSize: this.aiMessageCache.size,
            hasAIMode: document.querySelector('.ai-mode-indicator') !== null
        };
    }
};

// 导出到全局
window.AIUI = AIUI;
