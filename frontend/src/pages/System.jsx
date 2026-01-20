import React from 'react';
import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';

function System() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Settings size={18} /> 系统
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            该功能正在开发中。
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-4 p-4 rounded-lg border border-border bg-black/20"
          >
            <div className="text-sm text-white font-semibold">提示</div>
            <div className="text-sm text-muted-foreground mt-1">
              目前模型（LLM）配置会在页面加载时自动提示，如需手动调整，可在后续版本加入系统设置入口。
            </div>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default System;
