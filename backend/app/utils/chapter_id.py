"""
章节 ID 验证和管理工具

支持的格式:
- 正文: C0, C1, C2, ... C999
- 番外: C3E1, C3E2 (第3章后的番外)
- 幕间: C2I1, C2I2 (第2章后的幕间)
- 分卷: V1C1, V2C5 (可选)
"""

import re
from typing import Optional, Dict, List


class ChapterIDValidator:
    """章节ID验证器"""
    
    # 格式: [V数字]C数字[E/I数字]
    PATTERN = r'^(?:V(\d+))?C(\d+)(?:([EI])(\d+))?$'
    
    @staticmethod
    def validate(chapter_id: str) -> bool:
        """
        验证章节ID格式是否有效
        
        Args:
            chapter_id: 章节ID
            
        Returns:
            是否有效
            
        Examples:
            >>> ChapterIDValidator.validate('C1')
            True
            >>> ChapterIDValidator.validate('C3E1')
            True
            >>> ChapterIDValidator.validate('V2C5I2')
            True
            >>> ChapterIDValidator.validate('invalid')
            False
        """
        if not chapter_id:
            return False
        return re.match(ChapterIDValidator.PATTERN, chapter_id) is not None
    
    @staticmethod
    def parse(chapter_id: str) -> Optional[Dict]:
        """
        解析章节ID为各个组件
        
        Args:
            chapter_id: 章节ID
            
        Returns:
            包含volume, chapter, type, seq的字典，无效时返回None
            
        Examples:
            >>> ChapterIDValidator.parse('C3E1')
            {'volume': 0, 'chapter': 3, 'type': 'E', 'seq': 1}
            >>> ChapterIDValidator.parse('V2C5')
            {'volume': 2, 'chapter': 5, 'type': None, 'seq': 0}
        """
        match = re.match(ChapterIDValidator.PATTERN, chapter_id)
        if not match:
            return None
        
        return {
            'volume': int(match.group(1)) if match.group(1) else 0,
            'chapter': int(match.group(2)),
            'type': match.group(3),  # E, I 或 None
            'seq': int(match.group(4)) if match.group(4) else 0
        }
    
    @staticmethod
    def calculate_weight(chapter_id: str) -> float:
        """
        计算章节排序权重
        
        权重规则:
        - 基础分 = 卷号 * 1000 + 章节号
        - 番外/幕间在章节后: +0.1 * 序号
        
        Args:
            chapter_id: 章节ID
            
        Returns:
            排序权重，无效ID返回0
            
        Examples:
            >>> ChapterIDValidator.calculate_weight('C1')
            1.0
            >>> ChapterIDValidator.calculate_weight('C3E1')
            3.1
            >>> ChapterIDValidator.calculate_weight('C3E2')
            3.2
            >>> ChapterIDValidator.calculate_weight('V2C5')
            2005.0
        """
        parsed = ChapterIDValidator.parse(chapter_id)
        if not parsed:
            return 0.0
        
        base = parsed['volume'] * 1000 + parsed['chapter']
        
        # 番外和幕间使用小数偏移
        if parsed['type'] and parsed['seq'] > 0:
            base += 0.1 * parsed['seq']
        
        return base
    
    @staticmethod
    def sort_chapters(chapter_ids: List[str]) -> List[str]:
        """
        对章节ID列表进行排序
        
        Args:
            chapter_ids: 章节ID列表
            
        Returns:
            排序后的章节ID列表
            
        Examples:
            >>> ChapterIDValidator.sort_chapters(['C3', 'C1', 'C2E1', 'C2'])
            ['C1', 'C2', 'C2E1', 'C3']
        """
        return sorted(chapter_ids, key=ChapterIDValidator.calculate_weight)
    
    @staticmethod
    def suggest_next_id(existing_ids: List[str], chapter_type: str = 'normal', 
                       insert_after: Optional[str] = None) -> str:
        """
        根据现有章节建议下一个ID
        
        Args:
            existing_ids: 现有章节ID列表
            chapter_type: 章节类型 ('normal', 'extra', 'interlude')
            insert_after: 插入位置（仅对extra/interlude有效）
            
        Returns:
            建议的章节ID
            
        Examples:
            >>> ChapterIDValidator.suggest_next_id(['C1', 'C2'], 'normal')
            'C3'
            >>> ChapterIDValidator.suggest_next_id(['C1', 'C2'], 'extra', 'C2')
            'C2E1'
            >>> ChapterIDValidator.suggest_next_id(['C2', 'C2E1'], 'extra', 'C2')
            'C2E2'
        """
        if chapter_type == 'normal':
            # 找到最大的章节号
            max_chapter = 0
            for cid in existing_ids:
                parsed = ChapterIDValidator.parse(cid)
                if parsed and not parsed['type']:  # 只看正文章节
                    max_chapter = max(max_chapter, parsed['chapter'])
            return f'C{max_chapter + 1}'
        
        elif chapter_type in ['extra', 'interlude']:
            if not insert_after:
                return ''
            
            # 统计该章节后已有多少个同类型章节
            type_code = 'E' if chapter_type == 'extra' else 'I'
            count = 0
            for cid in existing_ids:
                if cid.startswith(insert_after) and type_code in cid:
                    parsed = ChapterIDValidator.parse(cid)
                    if parsed and parsed['type'] == type_code:
                        count = max(count, parsed['seq'])
            
            return f'{insert_after}{type_code}{count + 1}'
        
        return ''
    
    @staticmethod
    def get_type_label(chapter_id: str) -> str:
        """
        获取章节类型的中文标签
        
        Args:
            chapter_id: 章节ID
            
        Returns:
            类型标签
        """
        parsed = ChapterIDValidator.parse(chapter_id)
        if not parsed:
            return '未知'
        
        if not parsed['type']:
            if parsed['chapter'] == 0:
                return '序章'
            elif parsed['chapter'] == 999:
                return '尾声'
            else:
                return '正文'
        elif parsed['type'] == 'E':
            return '番外'
        elif parsed['type'] == 'I':
            return '幕间'
        
        return '未知'
